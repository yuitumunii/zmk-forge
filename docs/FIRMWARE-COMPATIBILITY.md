# Firmware Compatibility — Making Your Firmware Work with ZMK Forge
# ファーム対応 — 自分のファームを ZMK Forge 対応にする

**EN:** ZMK Forge has two tiers of compatibility:

| Feature | Firmware requirement |
|---|---|
| Keymap editing, GitHub Sync | **Any** ZMK Studio-compatible keyboard — nothing special needed |
| **Live Tuning** (macro/combo/tap-dance editing, CPI / timing / AML / gesture) | A firmware that implements the `pyuron_*` **custom Studio RPC** subsystems |

The Live Tuning panels only appear when the connected keyboard advertises the
custom RPC. This guide explains how to get that firmware. The fastest route is to
build against the reference ZMK fork below; advanced users can port the individual
subsystems into their own firmware.

**JA:** ZMK Forge の対応は2段階です。キーマップ編集と GitHub 同期は **どの ZMK Studio
対応キーボードでも** そのまま使えます。**ライブ調整**（マクロ/コンボ/タップダンス編集、
CPI/タイミング/AML/ジェスチャー）だけは、`pyuron_*` カスタム Studio RPC を実装した
ファームが必要です。一番速いのは下記リファレンス fork を使うこと。上級者は各サブシステムを
自分のファームへ移植できます。

> ## ⚠️ Status / 状態
> **EN:** This reference fork is **experimental**. The full feature set currently has
> an **unresolved intermittent freeze bug** (under investigation). Treat it as a
> tinkering / reference target, not a daily driver. Always pin a commit SHA.
>
> **JA:** このリファレンス fork は**実験的**です。全機能版は現状**未解決の間欠フリーズ
> 不具合**があり調査中です。常用ではなく、いじって試す/参照する対象としてご利用ください。
> SHA は必ず固定すること。

---

> **Reference fork / リファレンス fork**: https://github.com/yuitumunii/zmk
> **Full-featured branch / 全機能ブランチ**: `macro-overhaul-B` (SHA `82daaa4e9ec0fbefaf8626b143417aebb31d9e24`)
> **AML-only branch / AML単体ブランチ**: `pyuron-aml-rpc` (SHA `2b7d19b7bba2b6862027f406ee5c6792ac52bbac`)
> **Companion modules / 関連モジュール**:
> - `yuitumunii/zmk-input-processor-keybind` @ `gesture-overhaul-A` — gesture & dynamic-layer processor
> - `yuitumunii/zmk-pmw3610-driver` @ `live-cpi` — CPI live-tuning for PMW3610 sensors

---

## 1. What You Get / 何が手に入るか

| # | Feature (EN) | 機能 (JA) | Branch | Extra module |
|---|---|---|---|---|
| A | **AutoMouse Layer (AML) live config** — tune deactivation timeout, prior-idle guard, excluded key positions from ZMK Studio without reflashing | AML をリフラッシュなしでライブ調整 | `pyuron-aml-rpc` / `macro-overhaul-B` | — |
| B | **Hold-tap (&mt / &lt) timing live tuning** — change `tapping-term-ms`, `quick-tap-ms`, flavor per instance at runtime | ホールドタップのタイミングをライブ調整 | `macro-overhaul-B` | — |
| C | **Runtime macro editing** — live-edit up to 6 fixed macro slots from Studio | マクロをリフラッシュなしでライブ編集 | `macro-overhaul-B` | — |
| D | **Runtime combo editing** — live-edit up to 6 fixed combo slots (positions, binding, timeout, layer mask) | コンボをライブ編集 | `macro-overhaul-B` | — |
| E | **Runtime tap-dance editing** — live-edit up to 4 fixed tap-dance slots | タップダンスをライブ編集 | `macro-overhaul-B` | — |
| F | **Scroll-direction invert input processor** — toggle natural-scroll per-axis live from Studio | スクロール方向をライブ反転 | `macro-overhaul-B` | — |
| G | **Trackball speed multiplier** — scale cursor speed in % steps between sensor CPI stops | トラボ速度をライブ調整 | `macro-overhaul-B` | — |
| H | **Split CPI forward** — push CPI changes from central to peripheral trackball over BLE GATT | 左右分割でCPIをBLE転送 | `macro-overhaul-B` | — |
| I | **Gesture sensitivity live tuning** — tune tick / wait-ms / threshold per gesture processor | ジェスチャー感度をライブ調整 | `macro-overhaul-B` | `zmk-input-processor-keybind` |
| J | **Dynamic per-layer gesture binding** — assign direction bindings per layer, live-replaceable from Studio | レイヤーごとにジェスチャー割当をライブ差替 | `macro-overhaul-B` | `zmk-input-processor-keybind` |

All Studio RPC features require a companion desktop/web app that speaks the `cormoran` custom-studio-protocol wire format. The standard ZMK Studio UI at https://zmk.studio will **not** expose the Pyuron-specific panels.

すべての Studio RPC 機能は、`cormoran` custom-studio-protocol を話すカスタムデスクトップ/Webアプリが必要です。https://zmk.studio の標準 UI には Pyuron 専用パネルは表示されません。

---

## 2. ⚠️ Caveats / 注意事項

- **Unresolved freeze bug.** See the banner at the top of this file. The full-feature firmware intermittently freezes; root cause unknown. Do not rely on it.
  **未解決のフリーズ不具合があります。**（冒頭の警告参照）

- **Unofficial fork.** This is not the upstream ZMK project. It is maintained by a single person for the Pyuron keyboard. There is no guarantee of stability or long-term support.
  **非公式フォークです。** upstream ZMK プロジェクトではありません。個人が Pyuron キーボード向けに保守しています。

- **Not compatible with official ZMK Studio.** The RPC extensions use a custom protocol (`cormoran/zmk-studio-messages` fork) that is not merged into the official `zmkfirmware/zmk-studio-messages`. Official ZMK Studio will connect but will not show Pyuron custom panels.
  **公式 ZMK Studio との互換性はありません。**

- **Pin the SHA.** Branches are rebased and force-pushed frequently. Always pin a specific commit SHA in your `west.yml`. Never use branch names as `revision` in production.
  **SHA を固定してください。** ブランチは頻繁に rebase・force-push されます。

- **Breaking on upstream merges.** If you later merge `upstream/main` yourself you may need to re-integrate custom patches. Check the `app/src/studio/`, `app/src/behaviors/`, and `app/src/pointing/` directories for conflicts.
  **upstream マージで壊れることがあります。**

- **Use at your own risk.** These patches touch BLE GATT, NVS settings layout, and behavior internals. Test thoroughly before relying on any keyboard with these features.
  **自己責任でご利用ください。**

---

## 3. Prerequisites / 前提条件

- A working ZMK keyboard config (your own `zmk-config` repository, buildable with upstream ZMK).
  動作する ZMK キーボード設定リポジトリ（upstream ZMK でビルドできること）。
- Basic familiarity with `west.yml` and Kconfig (`prj.conf`).
- The features in Section 1 A–H live entirely in the `yuitumunii/zmk` fork. Features I–J additionally require the `yuitumunii/zmk-input-processor-keybind` module.
  A–H は `yuitumunii/zmk` フォーク単体。I–J はさらに `zmk-input-processor-keybind` モジュールが必要。
- Feature H (Split CPI forward) also requires `yuitumunii/zmk-pmw3610-driver` @ `live-cpi`.
  H は `zmk-pmw3610-driver` も必要。

---

## 4. Step 1 — Point Your `west.yml` to This Fork

### 4-1. Replace the `zmk` entry

In your config repository's `config/west.yml` (the `manifest` file your build system reads), replace the existing `zmk` project entry:

あなたの `config/west.yml` 内の `zmk` プロジェクトエントリを以下に差し替えます。

```yaml
manifest:
  remotes:
    # keep your other remotes ...
    - name: yuitumunii
      url-base: https://github.com/yuitumunii

  projects:
    - name: zmk
      remote: yuitumunii
      # Pin a specific SHA — never use a branch name as revision.
      # SHA固定必須。ブランチ名をrevisionに使わないこと。
      revision: 82daaa4e9ec0fbefaf8626b143417aebb31d9e24   # macro-overhaul-B tip (all features)
      # OR, for AML-only:
      # revision: 2b7d19b7bba2b6862027f406ee5c6792ac52bbac # pyuron-aml-rpc tip
      import: app/west.yml     # ← this line is critical
```

> **Effect of `import: app/west.yml`**
> The fork's `app/west.yml` declares:
> ```yaml
> - name: zmk-studio-messages
>   remote: cormoran
>   revision: 89b81d2e587fce807b668dff2a6967a40beef421
>   path: modules/msgs/zmk-studio-messages
> ```
> This automatically pulls in the `cormoran/zmk-studio-messages` fork (the custom-studio-protocol wire format). You do **not** need to add it separately; `west update` will fetch it automatically when you import the fork's `app/west.yml`.
> `import: app/west.yml` を書けば `cormoran/zmk-studio-messages` の依存も自動で入ります。別途追記は不要です。

### 4-2. Add companion modules (for features I–J)

```yaml
    # Gesture / dynamic-layer processor (features I, J)
    - name: zmk-input-processor-keybind
      remote: yuitumunii
      revision: gesture-overhaul-A    # pin a SHA in production
      path: modules/input-processor-keybind

    # PMW3610 driver with live CPI (feature H — only if your board uses PMW3610)
    - name: zmk-pmw3610-driver
      remote: yuitumunii
      revision: live-cpi              # pin a SHA in production
```

---

## 5. Step 2 — Enable Features via Kconfig (`prj.conf`)

Add the relevant lines to your keyboard's `prj.conf` (or the `.conf` file used by your build).

必要な機能だけ `prj.conf` に追記します。

| Feature | `prj.conf` line(s) | Source of CONFIG name |
|---|---|---|
| Custom Studio RPC base (required for A–J) | `CONFIG_ZMK_STUDIO=y` | `app/src/studio/Kconfig` |
| **A** AML live tuning | `CONFIG_ZMK_INPUT_PROCESSOR_TEMP_LAYER_STUDIO_RPC=y` | `app/src/pointing/Kconfig` |
| **B** Hold-tap timing live tuning | `CONFIG_PYURON_TIMING_STUDIO_RPC=y` | `app/src/studio/Kconfig` |
| **C** Macro live editing | `CONFIG_PYURON_MACRO_STUDIO_RPC=y` | `app/src/studio/Kconfig` |
| **D** Combo live editing | `CONFIG_PYURON_COMBO_STUDIO_RPC=y` | `app/src/studio/Kconfig` |
| **E** Tap-dance live editing | `CONFIG_PYURON_TAPDANCE_STUDIO_RPC=y` | `app/src/studio/Kconfig` |
| **F** Scroll-invert processor | `CONFIG_PYURON_SCROLL_STUDIO_RPC=y` *(auto-enables processor)* | `app/src/pointing/Kconfig` |
| **G** Speed multiplier processor | `CONFIG_PYURON_SPEED_STUDIO_RPC=y` *(auto-enables processor)* | `app/src/pointing/Kconfig` |
| **H** Split CPI forward (central half) | `CONFIG_ZMK_SPLIT_BLE_CENTRAL_CPI_FORWARD=y` | `app/src/split/bluetooth/Kconfig` |
| **H** Split CPI forward (peripheral half) | `CONFIG_ZMK_SPLIT_PERIPHERAL_CPI_FORWARD=y` | `app/src/split/bluetooth/Kconfig` |
| **H** PMW3610 live CPI RPC | `CONFIG_PMW3610_ALT_STUDIO_RPC_CPI=y` | `zmk-pmw3610-driver` Kconfig |
| **I/J** Gesture processor RPC | `CONFIG_ZMK_INPUT_PROCESSOR_KEYBIND_STUDIO_RPC=y` | `zmk-input-processor-keybind/src/pointing/Kconfig` |
| **J** Dynamic layer-aware gesture processor | *(enabled automatically by DTS — `CONFIG_ZMK_INPUT_PROCESSOR_KEYBIND_DYNAMIC` auto-set when the `zmk,input-processor-keybind-dynamic` node exists)* | same Kconfig |

Notes on ordering:
- `CONFIG_ZMK_STUDIO=y` selects `CONFIG_ZMK_STUDIO_RPC` automatically on the central.
- `CONFIG_ZMK_INPUT_PROCESSOR_TEMP_LAYER_STUDIO_RPC` depends on `CONFIG_ZMK_INPUT_PROCESSOR_TEMP_LAYER`, which itself is auto-enabled when a `zmk,input-processor-temp-layer` node is present in DTS.

---

## 6. Step 3 — Keymap / DTS Changes

### 6-1. AML: no new DTS property required

The AML processor continues to use the standard `zmk,input-processor-temp-layer` compatible. No property addition is needed to enable runtime tuning; the RPC subsystem finds the processor at runtime. Just ensure the node exists:

AML プロセッサは通常の `zmk,input-processor-temp-layer` をそのまま使います。DTS 変更は不要です。

```dts
/* existing, no change needed */
zip_temp_layer: zip_temp_layer {
    compatible = "zmk,input-processor-temp-layer";
    /* ... your existing properties ... */
};
```

### 6-2. Hold-tap timing: no new DTS property required

The existing `&mt` / `&lt` instances (compatible `"zmk,behavior-hold-tap"`) are detected by the timing RPC automatically. No property needs to be added.

`&mt` / `&lt` は自動検出されます。DTS 変更は不要です。

### 6-3. Macro live editing: add `pyuron-macro-slot`

*Source: `app/dts/bindings/behaviors/macro_base.yaml`*

Only macros that carry the `pyuron-macro-slot` property become live-editable. Slots are 0-indexed; max 6 slots (0–5). Add it to any `zmk,behavior-macro` node:

live 編集したいマクロに `pyuron-macro-slot` を追記します。

```dts
/ {
    behaviors {
        pmac0: pmac0 {
            compatible = "zmk,behavior-macro";
            #binding-cells = <0>;
            pyuron-macro-slot = <0>;    /* slot index 0–5 */
            bindings = <&kp A>;         /* initial/fallback binding */
        };
        pmac1: pmac1 {
            compatible = "zmk,behavior-macro";
            #binding-cells = <0>;
            pyuron-macro-slot = <1>;
            bindings = <&kp B>;
        };
    };
};
```

Property definition (from `macro_base.yaml`):
- Name: `pyuron-macro-slot`
- Type: `int`
- When set and `CONFIG_PYURON_MACRO_STUDIO_RPC=y`: steps are read from the RAM/NVS mirror for that slot instead of the flashed `bindings`.

### 6-4. Combo live editing: add `pyuron-combo-slot`

*Source: `app/dts/bindings/zmk,combos.yaml`*

```dts
/ {
    combos {
        compatible = "zmk,combos";
        combo0 {
            key-positions = <0 1>;
            bindings = <&kp ESC>;
            pyuron-combo-slot = <0>;    /* slot index 0–5 */
        };
    };
};
```

Property definition (from `zmk,combos.yaml`):
- Name: `pyuron-combo-slot`
- Type: `int`
- When set and `CONFIG_PYURON_COMBO_STUDIO_RPC=y`: key-positions, fire behavior, timeout, and layer mask are taken from the RAM/NVS mirror for that slot; the combo starts disabled until first configured via Studio.

### 6-5. Tap-dance live editing: add `pyuron-td-slot`

*Source: `app/dts/bindings/behaviors/zmk,behavior-tap-dance.yaml`*

```dts
/ {
    behaviors {
        ptd0: ptd0 {
            compatible = "zmk,behavior-tap-dance";
            #binding-cells = <0>;
            pyuron-td-slot = <0>;       /* slot index 0–3 */
            tapping-term-ms = <200>;    /* fallback default */
            bindings = <&kp A>, <&kp B>;
        };
    };
};
```

Property definition (from `zmk,behavior-tap-dance.yaml`):
- Name: `pyuron-td-slot`
- Type: `int`
- When set and `CONFIG_PYURON_TAPDANCE_STUDIO_RPC=y`: steps, count and tapping term are read from the RAM/NVS mirror for that slot.

### 6-6. Scroll-invert processor: include and wire

*Binding compatible: `"zmk,input-processor-pyuron-scroll-invert"`*
*Pre-built node: `zip_pyuron_scroll_invert`*
*DTSI include path: `<input/processors/pyuron_scroll_invert.dtsi>` (already included by `<input/processors.dtsi>`)*

*Source: `app/dts/input/processors/pyuron_scroll_invert.dtsi`, `app/dts/bindings/input_processors/zmk,input-processor-pyuron-scroll-invert.yaml`*

The node is already instantiated when you include `<input/processors.dtsi>`. Wire it into your input listener:

`<input/processors.dtsi>` をインクルードすれば `zip_pyuron_scroll_invert` ノードが自動生成されます。

```dts
/* In your .overlay or .keymap */
#include <input/processors.dtsi>

/* Wire into your trackball input listener */
&trackball_listener {
    input-processors = <&zip_pyuron_scroll_invert>;
};
```

`invert_v` / `invert_h` flags default to `false` (no inversion). Toggle them live via the `pyuron_scroll` Studio RPC.

### 6-7. Speed multiplier processor: include and wire

*Binding compatible: `"zmk,input-processor-pyuron-speed"`*
*Pre-built node: `zip_pyuron_speed`*
*DTSI include path: `<input/processors/pyuron_speed.dtsi>` (already included by `<input/processors.dtsi>`)*

*Source: `app/dts/input/processors/pyuron_speed.dtsi`, `app/dts/bindings/input_processors/zmk,input-processor-pyuron-speed.yaml`*

```dts
#include <input/processors.dtsi>

&trackball_listener {
    /* Place AFTER gesture detection so only cursor movement is scaled */
    input-processors = <&zip_keybind_dynamic>, <&zip_pyuron_speed>;
};
```

Runtime percent defaults to 100 (= ×1.0). Adjust live via the `pyuron_speed` Studio RPC.

### 6-8. Gesture processor: declare the DTS node

*Binding compatible: `"zmk,input-processor-keybind-dynamic"`*
*Source: `zmk-input-processor-keybind/dts/bindings/input_processors/zmk,input-processor-keybind-dynamic.yaml`*

```dts
/ {
    zip_keybind_dynamic: zip_keybind_dynamic {
        compatible = "zmk,input-processor-keybind-dynamic";
        #input-processor-cells = <0>;
        mode = <1>;            /* 1 = 4-way DPad (default) */
        tick = <180>;          /* movement units required to fire */
        wait-ms = <600>;
        tap-ms = <10>;
        threshold = <1>;
        max_threshold = <200>;
        track_remainders;
        guard-layers = <6 7>;  /* layers that pass through (e.g. mouse / scroll) */
    };
};
```

Key properties from `zmk,input-processor-keybind-dynamic.yaml`:

| Property | Type | Description |
|---|---|---|
| `mode` | `int` | 0=raw, 1=4-way DPad (default), 2=8-way DPad |
| `tick` | `int` | accumulated units to fire one key event (default 180) |
| `wait-ms` | `int` | cooldown ms after release (default 600) |
| `tap-ms` | `int` | press→release delay within one tap (default 10) |
| `threshold` | `int` | min per-event delta to pass filter (default 1) |
| `max_threshold` | `int` | max per-event delta before discard (default 200) |
| `track_remainders` | bool | carry sub-tick remainder |
| `guard-layers` | array | layers always passed through to cursor |
| `invert-x` / `invert-y` | bool | flip axis |
| `wedge-half-deg` | `int` | direction quantisation half-angle (default 45) |
| `deadzone-deg` | `int` | deadzone in degrees (default 0) |

---

## 7. Per-Feature Reference

### Feature A — AML live config (`pyuron_aml` RPC)

| Item | Value | Source file |
|---|---|---|
| Kconfig symbol | `CONFIG_ZMK_INPUT_PROCESSOR_TEMP_LAYER_STUDIO_RPC` | `app/src/pointing/Kconfig` |
| RPC subsystem identifier | `pyuron_aml` | `app/src/pointing/aml_studio.c` |
| Public API header | `app/include/zmk/pointing/aml.h` | — |
| Proto definition | `app/src/pointing/proto/pyuron/aml/aml.proto` | — |
| Tunable parameters | `deactivation_ms`, `prior_idle_ms`, `excluded_positions[]` (max 16) | `aml.h` |
| Persistence | NVS via Zephyr settings (`zmk_aml_save()`) | `aml_studio.c` |
| Security | `ZMK_STUDIO_RPC_HANDLER_UNSECURED` (no Studio unlock needed) | `aml_studio.c` |

### Feature B — Hold-tap timing (`pyuron_timing` RPC)

| Item | Value | Source file |
|---|---|---|
| Kconfig symbol | `CONFIG_PYURON_TIMING_STUDIO_RPC` | `app/src/studio/Kconfig` (macro-overhaul-B) |
| Header | `app/include/zmk/behaviors/hold_tap_tuning.h` | — |
| Tunable parameters | `tapping_term_ms`, `quick_tap_ms`, `flavor` | `hold_tap_tuning.h` |
| DTS change | None — all `zmk,behavior-hold-tap` instances auto-registered | — |
| Persistence | NVS per instance per param | `hold_tap_tuning.h` |

### Features C / D / E — Runtime macro / combo / tap-dance editing

| Item | Macro (C) | Combo (D) | Tap-dance (E) | Source |
|---|---|---|---|---|
| Kconfig symbol | `CONFIG_PYURON_MACRO_STUDIO_RPC` | `CONFIG_PYURON_COMBO_STUDIO_RPC` | `CONFIG_PYURON_TAPDANCE_STUDIO_RPC` | `app/src/studio/Kconfig` |
| DTS property name | `pyuron-macro-slot` | `pyuron-combo-slot` | `pyuron-td-slot` | `.yaml` bindings |
| Property type | `int` | `int` | `int` | — |
| Slot range | 0–5 (6 slots) | 0–5 (6 slots) | 0–3 (4 slots) | Kconfig help text |
| DTS binding file | `app/dts/bindings/behaviors/macro_base.yaml` | `app/dts/bindings/zmk,combos.yaml` | `app/dts/bindings/behaviors/zmk,behavior-tap-dance.yaml` | — |

### Feature F — Scroll-invert (`pyuron_scroll` RPC)

| Item | Value | Source |
|---|---|---|
| Kconfig symbol (driver) | `CONFIG_ZMK_INPUT_PROCESSOR_PYURON_SCROLL_INVERT` (auto by DTS) | `app/src/pointing/Kconfig` |
| Kconfig symbol (RPC) | `CONFIG_PYURON_SCROLL_STUDIO_RPC` | same |
| DTS compatible | `zmk,input-processor-pyuron-scroll-invert` | `app/dts/bindings/input_processors/zmk,input-processor-pyuron-scroll-invert.yaml` |
| Pre-built node label | `zip_pyuron_scroll_invert` | `app/dts/input/processors/pyuron_scroll_invert.dtsi` |
| Include path | `<input/processors/pyuron_scroll_invert.dtsi>` (via `<input/processors.dtsi>`) | same |
| Tunable flags | `invert_v` (vertical wheel), `invert_h` (horizontal wheel) | yaml description |

### Feature G — Speed multiplier (`pyuron_speed` RPC)

| Item | Value | Source |
|---|---|---|
| Kconfig symbol (driver) | `CONFIG_ZMK_INPUT_PROCESSOR_PYURON_SPEED` (auto by DTS) | `app/src/pointing/Kconfig` |
| Kconfig symbol (RPC) | `CONFIG_PYURON_SPEED_STUDIO_RPC` | same |
| DTS compatible | `zmk,input-processor-pyuron-speed` | `app/dts/bindings/input_processors/zmk,input-processor-pyuron-speed.yaml` |
| Pre-built node label | `zip_pyuron_speed` | `app/dts/input/processors/pyuron_speed.dtsi` |
| Include path | `<input/processors/pyuron_speed.dtsi>` (via `<input/processors.dtsi>`) | same |
| Default | 100% (×1.0) | yaml description |

### Feature H — Split CPI forward

| Item | Value | Source |
|---|---|---|
| Kconfig symbol (central) | `CONFIG_ZMK_SPLIT_BLE_CENTRAL_CPI_FORWARD` | `app/src/split/bluetooth/Kconfig` |
| Kconfig symbol (peripheral) | `CONFIG_ZMK_SPLIT_PERIPHERAL_CPI_FORWARD` | same |
| Central API header | `app/include/zmk/split/cpi_forward.h` | — |
| Central API function | `int zmk_split_bt_cpi_forward(uint8_t peripheral_idx, uint8_t sensor_id, uint16_t cpi)` | `cpi_forward.h` |
| PMW3610 RPC Kconfig | `CONFIG_PMW3610_ALT_STUDIO_RPC_CPI` | `zmk-pmw3610-driver` *(要確認: not directly read)* |

### Features I / J — Gesture RPC & dynamic layer binding

| Item | Value | Source |
|---|---|---|
| Module path in west.yml | `modules/input-processor-keybind` | `config/west.yml` |
| Kconfig symbol (RPC) | `CONFIG_ZMK_INPUT_PROCESSOR_KEYBIND_STUDIO_RPC` | `zmk-input-processor-keybind/src/pointing/Kconfig` |
| Kconfig symbol (static processor) | `CONFIG_ZMK_INPUT_PROCESSOR_KEYBIND` (auto by DTS) | same |
| Kconfig symbol (dynamic processor) | `CONFIG_ZMK_INPUT_PROCESSOR_KEYBIND_DYNAMIC` (auto by DTS) | same |
| DTS compatible (dynamic) | `zmk,input-processor-keybind-dynamic` | `dts/bindings/input_processors/zmk,input-processor-keybind-dynamic.yaml` |
| DTS compatible (static) | `zmk,input-processor-keybind` | `dts/bindings/input_processors/zmk,input-processor-keybind.yaml` |
| RPC subsystem identifier | `pyuron_gesture` | `src/studio/gesture_handler.c` |
| API header | `include/zmk/pointing/gesture_layer.h` | — |

---

## 8. Branch Map — Which SHA Has What

```
pyuron-aml-rpc @ 2b7d19b7
  └─ Custom Studio RPC base (cormoran custom-studio-protocol)
  └─ Feature A: AML live config (pyuron_aml RPC)
  └─ Split BLE relay event (large chunked payload support)

macro-overhaul-B @ 82daaa4e
  └─ Everything in pyuron-aml-rpc, PLUS:
  └─ Feature B: Hold-tap timing (pyuron_timing RPC)
  └─ Feature C: Macro live editing (pyuron_macro RPC)
  └─ Feature D: Combo live editing (pyuron_combo RPC)
  └─ Feature E: Tap-dance live editing (pyuron_tapdance RPC)
  └─ Feature F: Scroll-invert processor (pyuron_scroll RPC)
  └─ Feature G: Speed multiplier (pyuron_speed RPC)
  └─ Feature H: Split CPI forward GATT characteristic

zmk-input-processor-keybind @ gesture-overhaul-A  ← separate module
  └─ Feature I: Gesture sensitivity RPC (pyuron_gesture RPC)
  └─ Feature J: Dynamic per-layer gesture binding + NVS persistence

zmk-pmw3610-driver @ live-cpi  ← separate module, PMW3610 boards only
  └─ Feature H complement: CONFIG_PMW3610_ALT_STUDIO_RPC_CPI live CPI
```

> **Note / 備考**: `pyuron-aml-rpc` (SHA `2b7d19b7`) contains **only** the AML RPC and
> the custom-studio-protocol base. The full feature set (timing / macro / combo /
> tap-dance / scroll / speed / split-CPI RPC) lives on **`macro-overhaul-B`**
> (SHA `82daaa4e`). The minimal day-to-day config in this repository uses *neither*
> — it pins the stable `pyuron-input-stop-fix` branch (upstream ZMK + a one-line
> gesture fix, no custom RPC).

---

## 9. Keeping Up to Date / バージョン追従

**The short version: upgrade cautiously and pin SHAs.**

1. **cormoran/zmk-studio-messages** — the fork's `app/west.yml` pins it to `89b81d2e587fce807b668dff2a6967a40beef421`. If `yuitumunii/zmk` updates this pin in a later commit, run `west update` after bumping your SHA.

2. **upstream ZMK merges** — changes to `app/src/behaviors/behavior_hold_tap.c`, `app/src/studio/`, or `app/src/pointing/input_processor_temp_layer.c` in upstream may conflict with the Pyuron patches. If you see build errors after bumping the SHA, check for conflicts in those files.

3. **Troubleshooting checklist**:
   - Build error in `aml_studio.c` / `custom_subsystem.c` → likely `cormoran/zmk-studio-messages` ABI changed; check the `app/west.yml` pin.
   - `CONFIG_PYURON_TIMING_STUDIO_RPC` not recognized → you are on `pyuron-aml-rpc`, not `macro-overhaul-B`.
   - Scroll/speed processor node not found → `<input/processors.dtsi>` not included, or wrong branch SHA.
   - Gesture processor not compiling → `zmk-input-processor-keybind` module missing from `west.yml`.

---

## 10. Credits / License

- **ZMK Firmware** — https://github.com/zmkfirmware/zmk — MIT License
- **cormoran/zmk-studio-messages** (custom-studio-protocol) — https://github.com/cormoran/zmk-studio-messages — MIT License
- **yuitumunii/zmk** (this fork) — MIT License
- **yuitumunii/zmk-input-processor-keybind** — MIT License
- **yuitumunii/zmk-pmw3610-driver** — MIT License
