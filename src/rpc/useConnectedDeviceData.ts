import React, { SetStateAction, useContext, useEffect, useState } from "react";
import { ConnectionContext } from "./ConnectionContext";

import { call_rpc } from "./logging";

import { Request, RequestResponse } from "@zmkfirmware/zmk-studio-ts-client";
import { LockStateContext } from "./LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";

export function useConnectedDeviceData<T>(
  req: Omit<Request, "requestId">,
  response_mapper: (resp: RequestResponse) => T | undefined,
  requireUnlock?: boolean
): [T | undefined, React.Dispatch<SetStateAction<T | undefined>>] {
  const connection = useContext(ConnectionContext);
  const lockState = useContext(LockStateContext);
  const [data, setData] = useState<T | undefined>(undefined);

  useEffect(
    () => {
      if (
        !connection.conn ||
        (requireUnlock &&
          lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED)
      ) {
        setData(undefined);
        return;
      }

      async function startRequest() {
        setData(undefined);
        if (!connection.conn) {
          return;
        }

        const response = response_mapper(await call_rpc(connection.conn, req));

        if (!ignore) {
          setData(response);
        }
      }

      let ignore = false;
      startRequest().catch((e) => {
        // 切断後など ignore=true の場合はエラーを無視する
        if (!ignore) {
          console.error("useConnectedDeviceData: startRequest failed", e);
        }
      });

      return () => {
        ignore = true;
      };
    },
    // req と response_mapper は呼び出し元でインライン生成されるため参照が毎回変わる。
    // 依存に含めると無限再実行になるため意図的に省略している。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    requireUnlock
      ? [connection, requireUnlock, lockState]
      : [connection, requireUnlock]
  );

  return [data, setData];
}
