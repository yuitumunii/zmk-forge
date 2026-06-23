import { useCallback, useEffect, useMemo, useState } from "react";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { AvailableDevice } from "./transport/types";
import { Bluetooth, RefreshCw, Keyboard, Loader2 } from "lucide-react";
import { Key, ListBox, ListBoxItem, Selection } from "react-aria-components";
import { useModalRef } from "./misc/useModalRef";
import { ExternalLink } from "./misc/ExternalLink";
import { isDesktop } from "./desktop";
import { GenericModal } from "./GenericModal";
import { useToast } from "./misc/toast";
import { UiButton } from "./misc/ui";

export type TransportFactory = {
  label: string;
  isWireless?: boolean;
  connect?: () => Promise<RpcTransport>;
  pick_and_connect?: {
    list: () => Promise<Array<AvailableDevice>>;
    connect: (dev: AvailableDevice) => Promise<RpcTransport>;
  };
};

export interface ConnectModalProps {
  open?: boolean;
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
  autoConnecting?: boolean;
  onError?: (msg: string) => void;
  /** 実機なしでUIを確認するためのデモ接続を開始する。 */
  onDemo?: () => void;
}

// NOTE: フックを含むUI断片は必ず「コンポーネント」として定義し<JSX>で描画する。
// ただの関数として条件分岐から呼ぶと、レンダー間でフック数が変わり
// React #300 (Rendered fewer hooks than expected) でアプリ全体が落ちる(2026-06-12実害)。
function DeviceList({
  open,
  transports,
  onTransportCreated,
  onError,
}: {
  open: boolean;
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
  onError?: (msg: string) => void;
}) {
  const [devices, setDevices] = useState<
    Array<[TransportFactory, AvailableDevice]>
  >([]);
  const [selectedDev, setSelectedDev] = useState(new Set<Key>());
  const [refreshing, setRefreshing] = useState(false);

  async function LoadEm() {
    setRefreshing(true);
    const entries: Array<[TransportFactory, AvailableDevice]> = [];
    for (const t of transports.filter((t) => t.pick_and_connect)) {
      const devices = await t.pick_and_connect?.list();
      if (!devices) {
        continue;
      }

      entries.push(
        ...devices.map<[TransportFactory, AvailableDevice]>((d) => {
          return [t, d];
        })
      );
    }

    setDevices(entries);
    setRefreshing(false);
  }

  useEffect(() => {
    setSelectedDev(new Set());
    setDevices([]);

    LoadEm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LoadEm is intentionally stable; adding it would re-trigger on every render
  }, [transports, open, setDevices]);

  const onRefresh = useCallback(() => {
    setSelectedDev(new Set());
    setDevices([]);

    LoadEm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- LoadEm is a stable local function; not a dep
  }, [setDevices]);

  const onSelect = useCallback(
    async (keys: Selection) => {
      if (keys === "all") {
        return;
      }
      const dev = devices.find(([, d]) => keys.has(d.id));
      if (dev) {
        dev[0]
          .pick_and_connect!.connect(dev[1])
          .then(onTransportCreated)
          .catch((e) => onError?.(e instanceof Error ? e.message : String(e)));
      }
    },
    [devices, onTransportCreated, onError]
  );

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto] items-center mb-1">
        <span className="text-sm text-base-content">デバイスを選択</span>
        <button
          type="button"
          className="p-1 rounded-md hover:bg-base-300 disabled:opacity-75 transition-colors"
          disabled={refreshing}
          onClick={onRefresh}
          aria-label="更新"
        >
          <RefreshCw
            className={`size-4 transition-transform ${
              refreshing ? "animate-spin" : ""
            }`}
          />
        </button>
      </div>
      <ListBox
        aria-label="デバイス"
        items={devices}
        onSelectionChange={onSelect}
        selectionMode="single"
        selectedKeys={selectedDev}
        className="flex flex-col gap-1 pt-1"
      >
        {([t, d]) => (
          <ListBoxItem
            className="rounded-md px-3 py-2 hover:bg-base-300 cursor-pointer transition-colors flex items-center gap-2"
            id={d.id}
            aria-label={d.label}
          >
            {t.isWireless && (
              <Bluetooth className="size-4 shrink-0 text-muted" aria-hidden />
            )}
            <span className="text-sm">{d.label}</span>
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
}

function SimpleDevicePicker({
  transports,
  onTransportCreated,
  autoConnecting,
  onError,
}: {
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
  autoConnecting?: boolean;
  onError?: (msg: string) => void;
}) {
  const [availableDevices, setAvailableDevices] = useState<
    AvailableDevice[] | undefined
  >(undefined);
  const [selectedTransport, setSelectedTransport] = useState<
    TransportFactory | undefined
  >(undefined);

  useEffect(() => {
    if (!selectedTransport) {
      setAvailableDevices(undefined);
      return;
    }

    let ignore = false;

    if (selectedTransport.connect) {
      const connectTransport = async () => {
        try {
          const transport = await selectedTransport?.connect?.();

          if (!ignore) {
            if (transport) {
              onTransportCreated(transport);
            }
            setSelectedTransport(undefined);
          }
        } catch (e) {
          if (!ignore) {
            console.error(e);
            if (e instanceof Error && !(e instanceof UserCancelledError)) {
              onError?.(e.message);
            }
            setSelectedTransport(undefined);
          }
        }
      };

      connectTransport();
    } else {
      const loadAvailableDevices = async () => {
        const devices = await selectedTransport?.pick_and_connect?.list();

        if (!ignore) {
          setAvailableDevices(devices);
        }
      };

      loadAvailableDevices();
    }

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs only on selectedTransport change (upstream zmk-studio pattern)
  }, [selectedTransport]);

  // A direct-connect transport (USB/BLE) is "scanning" while its connect()
  // promise is pending (waiting for the OS device chooser / BLE discovery).
  const scanning = !!(selectedTransport && selectedTransport.connect);

  // BLE トランスポートを先頭に、接続ボタンを1つに絞る（単一CTA）
  const bleTransport = transports.find((t) => t.isWireless && t.connect);
  const otherTransports = transports.filter((t) => t !== bleTransport);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        キーボードの電源を入れて接続してください。
      </p>

      {/* BLE 単一CTA */}
      {bleTransport && (
        <UiButton
          variant="primary"
          className="w-full justify-center gap-2"
          disabled={scanning || autoConnecting}
          onClick={() => setSelectedTransport(bleTransport)}
        >
          <Bluetooth className="size-4" aria-hidden />
          BLE で接続
        </UiButton>
      )}

      {/* BLE 以外のトランスポート */}
      {otherTransports.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {otherTransports.map((t) => (
            <li key={t.label} className="list-none">
              <UiButton
                variant="outline"
                className="w-full justify-center"
                disabled={scanning || autoConnecting}
                onClick={() => setSelectedTransport(t)}
              >
                {t.label}
              </UiButton>
            </li>
          ))}
        </ul>
      )}

      {/* スキャン中帯 */}
      {scanning && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-base-300 px-3 py-2">
          <RefreshCw className="size-4 animate-spin shrink-0 text-muted" />
          <span className="text-sm text-base-content flex-1">
            デバイスを探しています… キーボードの電源を入れてください
          </span>
          <button
            type="button"
            className="ml-auto rounded-md bg-base-100 hover:bg-base-200 px-2 py-1 text-sm transition-colors"
            onClick={() => setSelectedTransport(undefined)}
          >
            キャンセル
          </button>
        </div>
      )}

      {selectedTransport && availableDevices && (
        <ul className="flex flex-col gap-1 mt-1">
          {availableDevices.map((d) => (
            <li
              key={d.id}
              className="rounded-md px-3 py-2 hover:bg-base-300 cursor-pointer transition-colors flex items-center gap-2"
              onClick={async () => {
                onTransportCreated(
                  await selectedTransport!.pick_and_connect!.connect(d)
                );
                setSelectedTransport(undefined);
              }}
            >
              <Bluetooth className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="text-sm">{d.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function noTransportsOptionsPrompt() {
  // デスクトップ(Electron)版では BLE トランスポートが常に存在するため通常ここには
  // 到達しないが、保険として Web 専用の案内(対応ブラウザへの誘導・アプリ DL リンク)は
  // 出さない。href="/download" は file:// で死リンクになるため特に除外する。
  if (isDesktop()) {
    return (
      <div className="flex flex-col gap-2 mt-2">
        <p className="text-sm text-base-content">
          利用可能な接続方法が見つかりませんでした。Bluetooth
          が有効になっているか確認し、キーボードの電源を入れて再度お試しください。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 mt-2">
      <p className="text-sm text-base-content">
        お使いのブラウザは対応していません。ZMK Forge は{" "}
        <ExternalLink href="https://caniuse.com/web-serial">
          Web Serial
        </ExternalLink>{" "}
        または{" "}
        <ExternalLink href="https://caniuse.com/web-bluetooth">
          Web Bluetooth
        </ExternalLink>{" "}
        （Linux のみ）を使用してデバイスに接続します。
      </p>

      <div>
        <p className="text-sm text-base-content">利用するには:</p>
        <ul className="list-disc list-inside text-sm text-muted mt-1 space-y-1">
          <li>Chrome / Edge など対応ブラウザを使用する、または</li>
          <li>
            <ExternalLink href="/download">クロスプラットフォームアプリ</ExternalLink>
            をダウンロードする
          </li>
        </ul>
      </div>
    </div>
  );
}

function ConnectOptions({
  transports,
  onTransportCreated,
  open,
  autoConnecting,
  onError,
}: {
  transports: TransportFactory[];
  onTransportCreated: (t: RpcTransport) => void;
  open?: boolean;
  autoConnecting?: boolean;
  onError?: (msg: string) => void;
}) {
  const useSimplePicker = useMemo(
    () => transports.every((t) => !t.pick_and_connect),
    [transports]
  );

  return useSimplePicker ? (
    <SimpleDevicePicker
      transports={transports}
      onTransportCreated={onTransportCreated}
      autoConnecting={autoConnecting}
      onError={onError}
    />
  ) : (
    <DeviceList
      open={open || false}
      transports={transports}
      onTransportCreated={onTransportCreated}
      onError={onError}
    />
  );
}

export const ConnectModal = ({
  open,
  transports,
  onTransportCreated,
  autoConnecting,
  onDemo,
}: ConnectModalProps) => {
  const dialog = useModalRef(open || false, false, false);
  const { toast } = useToast();

  const handleError = useCallback(
    (msg: string) => {
      toast(msg, { variant: "error" });
    },
    [toast]
  );

  const haveTransports = useMemo(() => transports.length > 0, [transports]);

  return (
    <GenericModal ref={dialog} className="max-w-xl w-full">
      {/* autoConnecting 中: 全面「接続中」表示 */}
      {autoConnecting ? (
        <div className="flex flex-col items-center justify-center gap-4 py-8">
          <Keyboard className="size-10 text-muted" aria-hidden />
          <p className="text-base text-base-content">
            ZMK キーボードに接続しています…
          </p>
          <Loader2 className="size-5 animate-spin text-muted" aria-hidden />
        </div>
      ) : (
        <>
          <h1 className="text-lg font-semibold text-base-content mb-1">
            接続
          </h1>
          {haveTransports ? (
            <ConnectOptions
              transports={transports}
              onTransportCreated={onTransportCreated}
              open={open}
              autoConnecting={autoConnecting}
              onError={handleError}
            />
          ) : (
            noTransportsOptionsPrompt()
          )}

          {onDemo && (
            <div className="mt-4 border-t border-border pt-3">
              <UiButton
                variant="outline"
                className="w-full justify-center gap-2"
                onClick={onDemo}
              >
                <Keyboard className="size-4" aria-hidden />
                デモを見る（実機なし）
              </UiButton>
              <p className="mt-1.5 text-center text-xs text-muted">
                サンプルのキーマップで画面を確認できます。
              </p>
            </div>
          )}
        </>
      )}
    </GenericModal>
  );
};
