import Emittery from "emittery";
import { useEffect, useRef } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
// イベントバスは任意のペイロードを扱うため any を意図的に使う
const emitter = new Emittery<Record<PropertyKey, any>>();

/**
 * publish はモジュールスコープの emitter を直接使う純粋関数。
 * React Hook ではないので、コンポーネント外・async 関数内でも呼べる。
 */
export const publish = (name: PropertyKey, data: any) =>
  emitter.emit(name, data);
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * @deprecated 新規コードでは publish を使う。
 * 後方互換: コンポーネント内で usePub() と呼んでいる既存コードがある場合の
 * エイリアス。Hook ルール違反を避けるため内部では publish を返すだけ。
 */
export const usePub = () => publish;

export const useSub = (
  name: PropertyKey,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (data: any) => void | Promise<void>
) => {
  // callbackをrefで保持することで、毎描画で参照が変わっても再購読しない
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (data: any) => callbackRef.current(data);
    emitter.on(name, handler);
    // handler を ref で保持し、登録した関数と同じ参照で off する
    const unsub = () => emitter.off(name, handler);
    // Be sure we unsub if unmounted.
    return unsub;
  }, [name]);
};
