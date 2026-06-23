// Node-side git plumbing for "Sync to GitHub". Runs in the desktop build
// (Electron main / CLI), NOT in the browser — it uses
// node:fs and the `git` CLI. Browser code must not import this module.
//
// Flow: read existing .keymap -> merge device bindings -> write back ->
// git add/commit -> (optionally) push. Push needs a token-authenticated
// remote and is deliberately a separate, explicit step.

import { readFile, writeFile, chmod, unlink, rmdir, lstat, realpath } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import {
  mergeIntoExistingKeymap,
  type BehaviorMap,
  type MergeResult,
} from "./serializeKeymap";

const exec = promisify(execFile);

export interface SyncConfig {
  /** Absolute path to the local clone of the user's zmk-config fork. */
  clonePath: string;
  /** Path to the keymap file, relative to clonePath (e.g. config/keyboard.keymap). */
  keymapRelPath: string;
  /** Branch to commit/push (default: main). */
  branch?: string;
  /** Remote name (default: origin). */
  remote?: string;
}

async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    env: env ? { ...process.env, ...env } : undefined,
  });
  return stdout.trim();
}

/**
 * Merge the device keymap into the clone's existing .keymap and write it back.
 * Returns the merge stats so the caller can warn on a layer-count mismatch.
 */
export async function writeMergedKeymap(
  config: SyncConfig,
  keymap: Keymap,
  behaviors: BehaviorMap
): Promise<{ filePath: string; merge: MergeResult; changed: boolean }> {
  // パストラバーサル防止①: keymapRelPath に "../" 等を含む場合に clonePath 外への
  // 書き込みが発生しないよう、resolve した結果が clonePath 配下にあることを確認する。
  const filePath = join(config.clonePath, config.keymapRelPath);
  const resolvedFile = resolve(filePath);
  const resolvedClone = resolve(config.clonePath);
  if (!resolvedFile.startsWith(resolvedClone + "/") && resolvedFile !== resolvedClone) {
    throw new Error(
      `Path traversal detected: keymapRelPath '${config.keymapRelPath}' resolves outside clonePath`
    );
  }

  // パストラバーサル防止②: シンボリックリンク経由で clone 外へ脱出できないよう、
  // realpath (symlink を全解決した実体パス) が clonePath 配下にあることを確認する。
  // ファイルがまだ存在しない場合は親ディレクトリで検証する。
  const realClone = await realpath(config.clonePath);
  let statTarget = filePath;
  let realTarget: string;
  try {
    // ファイルが存在する場合は実体パスを取得する
    realTarget = await realpath(filePath);
  } catch {
    // ファイル未存在なら親ディレクトリで確認 (新規作成パスのトラバーサル防止)
    const parentReal = await realpath(resolve(filePath, "..")).catch(() => null);
    if (!parentReal || (!parentReal.startsWith(realClone + "/") && parentReal !== realClone)) {
      throw new Error(
        `Path traversal detected (via parent dir): keymapRelPath '${config.keymapRelPath}' resolves outside clonePath`
      );
    }
    realTarget = null as unknown as string; // 新規ファイル、以降のシンボリックリンクチェック不要
    statTarget = ""; // フラグとして使用
  }
  if (statTarget !== "") {
    // ファイルが存在する場合: symlink 経由での脱出と、clonePath 外への到達を拒否する
    const fileStat = await lstat(filePath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(
        `Symlink rejected: keymapRelPath '${config.keymapRelPath}' is a symbolic link. Use a regular file.`
      );
    }
    if (!realTarget.startsWith(realClone + "/") && realTarget !== realClone) {
      throw new Error(
        `Path traversal detected (via realpath): keymapRelPath '${config.keymapRelPath}' resolves outside clonePath`
      );
    }
  }

  const existing = await readFile(filePath, "utf8");
  const merge = mergeIntoExistingKeymap(existing, keymap, behaviors);
  const changed = merge.text !== existing;
  if (changed) {
    await writeFile(filePath, merge.text, "utf8");
  }
  return { filePath, merge, changed };
}

/** git add <keymap> && git commit. Returns the new commit SHA, or null if nothing to commit. */
export async function commitKeymap(
  config: SyncConfig,
  message: string
): Promise<string | null> {
  await git(config.clonePath, ["add", "--", config.keymapRelPath]);
  // Nothing staged? (no diff) -> skip commit.
  const status = await git(config.clonePath, ["status", "--porcelain"]);
  if (!status) {
    return null;
  }
  await git(config.clonePath, ["commit", "-m", message]);
  return git(config.clonePath, ["rev-parse", "HEAD"]);
}

/**
 * Git 参照名として不正な値を弾く。
 * - 先頭が '-' の場合、git コマンドのオプションとして解釈される可能性がある (インジェクション)。
 * - 空文字も拒否する。
 * - git check-ref-format が通る文字列のみ許可する。
 */
function assertSafeGitRef(value: string, label: string): void {
  if (!value) {
    throw new Error(`Git ${label} must not be empty`);
  }
  if (value.startsWith("-")) {
    throw new Error(
      `Git ${label} '${value}' starts with '-' which is invalid and could be interpreted as a flag`
    );
  }
  // 制御文字・空白・特殊シーケンスを含む参照名を拒否
  // git check-ref-format の主要ルール: スペース/\x00-\x1f/\x7f/^../@{/\\/ など
  // ここでは最低限のチェックとして制御文字・スペース・危険シーケンスを拒否する
  // eslint-disable-next-line no-control-regex -- intentional: sanitizing git ref names against control characters
  if (/[\x00-\x1f\x7f ]/.test(value)) {
    throw new Error(`Git ${label} '${value}' contains invalid characters`);
  }
  if (/\.\.|@\{|\\/.test(value)) {
    throw new Error(`Git ${label} '${value}' contains invalid sequences (.., @{, \\)`);
  }
}

/**
 * Push to the remote. If `token` is given, it is passed via a temporary
 * GIT_ASKPASS script so it does NOT appear in the process argument list
 * (where `ps aux` or logs could expose it) and is NOT written to git config.
 * The temporary script file is deleted immediately after the push.
 * Kept separate from commit so write+commit can be tested without credentials.
 */
export async function pushKeymap(
  config: SyncConfig,
  token?: string
): Promise<void> {
  const remote = config.remote ?? "origin";
  const branch = config.branch ?? "main";
  assertSafeGitRef(remote, "remote");
  assertSafeGitRef(branch, "branch");
  if (token) {
    const url = await git(config.clonePath, ["remote", "get-url", remote]);
    if (!/^https:\/\//.test(url)) {
      throw new Error(
        `Remote '${remote}' is not an https URL; token auth needs https (got ${url.replace(/\/\/.*@/, "//")})`
      );
    }
    // GIT_ASKPASS 方式: トークンを argv に埋め込まず一時スクリプト経由で渡す。
    // ps aux やログにトークンが露出しない。スクリプトは push 完了直後に削除する。
    // シェルのシングルクォートエスケープ: ' → '\''
    const escapedToken = token.replace(/'/g, "'\\''");
    const askpassScript = `#!/bin/sh\necho '${escapedToken}'\n`;
    const tmpDir = mkdtempSync(join(tmpdir(), "zmk-push-"));
    const askpassPath = join(tmpDir, "askpass.sh");
    try {
      await writeFile(askpassPath, askpassScript, "utf8");
      await chmod(askpassPath, 0o700);
      await git(config.clonePath, ["push", remote, `HEAD:${branch}`], {
        GIT_ASKPASS: askpassPath,
        GIT_TERMINAL_PROMPT: "0",
      });
    } finally {
      // クリーンアップ: トークンを含む一時ファイルを即削除する
      try { await unlink(askpassPath); } catch { /* ignore */ }
      try { await rmdir(tmpDir); } catch { /* ignore */ }
    }
  } else {
    await git(config.clonePath, ["push", remote, branch]);
  }
}

/**
 * Align the clone to the latest remote state, then merge the device keymap on
 * top. Shared by preview + commit so both reason about the SAME up-to-date base
 * (the repo's latest), which is what lets us warn when the device differs from
 * what's on GitHub.
 */
async function syncToRemoteAndMerge(
  config: SyncConfig,
  keymap: Keymap,
  behaviors: BehaviorMap
): Promise<{ merge: MergeResult; changed: boolean }> {
  const remote = config.remote ?? "origin";
  const branch = config.branch ?? "main";

  // Git 参照名バリデーション: fetch/checkout/reset に渡す前に不正な値を弾く
  assertSafeGitRef(remote, "remote");
  assertSafeGitRef(branch, "branch");

  await git(config.clonePath, ["fetch", remote, branch]);
  await git(config.clonePath, ["checkout", branch]);

  // データ消失ガード: ユーザーのコミットされていない変更(ステージング済み・未済の両方)が
  // 存在する場合は reset --hard を中止してエラーを返す。
  // clonePath には ZMK Forge 専用の clone を設定する必要がある。
  // 通常の zmk-config 作業コピーを指定すると、ここで保護されるが sync は実行できない。
  const porcelain = await git(config.clonePath, ["status", "--porcelain"]);
  if (porcelain) {
    throw new Error(
      `Uncommitted changes detected in '${config.clonePath}'. ` +
      `Sync aborted to prevent data loss from 'reset --hard'. ` +
      `Set 'Local clone folder' to a ZMK Forge-dedicated clone (not your main working copy), ` +
      `or commit / stash changes in that directory first.`
    );
  }

  // reset --hard: fetch した最新のリモートブランチに合わせる。
  // 上記 dirty チェックが通った場合のみここに到達する (未コミット変更なし)。
  await git(config.clonePath, ["reset", "--hard", `${remote}/${branch}`]);
  return writeMergedKeymap(config, keymap, behaviors);
}

/**
 * Preview what a sync would change WITHOUT committing or pushing: returns a
 * unified diff of the device keymap against the repo's latest. `changed` is
 * false when the device already matches GitHub (a safe no-op).
 */
export async function previewSync(
  config: SyncConfig,
  keymap: Keymap,
  behaviors: BehaviorMap
): Promise<{ changed: boolean; diff: string; merge: MergeResult }> {
  const { merge, changed } = await syncToRemoteAndMerge(config, keymap, behaviors);
  const diff = changed
    ? await git(config.clonePath, ["diff", "--", config.keymapRelPath])
    : "";
  return { changed, diff, merge };
}

/**
 * Commit the device keymap (merged onto the repo's latest) and push it. Call
 * only after the user has confirmed the preview — pushing triggers a firmware
 * build on the repo.
 */
export async function commitPushSync(
  config: SyncConfig,
  keymap: Keymap,
  behaviors: BehaviorMap,
  message: string,
  token?: string
): Promise<{ sha: string | null; merge: MergeResult; pushed: boolean }> {
  const { merge } = await syncToRemoteAndMerge(config, keymap, behaviors);
  const sha = await commitKeymap(config, message);
  let pushed = false;
  if (sha) {
    await pushKeymap(config, token);
    pushed = true;
  }
  return { sha, merge, pushed };
}

/** Convenience: write -> commit -> push, in one call. */
export async function syncToGitHub(
  config: SyncConfig,
  keymap: Keymap,
  behaviors: BehaviorMap,
  message: string,
  { push = true }: { push?: boolean } = {},
  token?: string
): Promise<{ sha: string | null; merge: MergeResult; pushed: boolean }> {
  const { merge } = await writeMergedKeymap(config, keymap, behaviors);
  const sha = await commitKeymap(config, message);
  let pushed = false;
  if (push && sha) {
    await pushKeymap(config, token);
    pushed = true;
  }
  return { sha, merge, pushed };
}
