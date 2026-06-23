// 下部キー設定パネル(Key Config)。キーボードの下に横長配置。
// 調整4タブは右のTuningRailからTuningModal(ポップアップ)で開く。


import { MousePointerClick } from "lucide-react";
import { BehaviorBindingPicker } from "../behaviors/BehaviorBindingPicker";
import { EmptyState } from "../misc/ui";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

export interface ConfigPanelProps {
  binding: BehaviorBinding | null;
  behaviors: GetBehaviorDetailsResponse[];
  layers: { id: number; name: string }[];
  onBindingChanged: (binding: BehaviorBinding) => void;
}

export function ConfigPanel({
  binding,
  behaviors,
  layers,
  onBindingChanged,
}: ConfigPanelProps) {
  return (
    <div className="h-full w-full bg-base-200 flex flex-col min-h-0">
      {/* 見出しバー */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <span className="text-2xs font-semibold tracking-wide text-muted uppercase">
          キー設定
        </span>
      </div>
      {/* コンテンツ */}
      <div className="p-3 overflow-auto min-h-0 flex-1">
        {binding ? (
          <div className="max-w-md">
            <BehaviorBindingPicker
              binding={binding}
              behaviors={behaviors}
              layers={layers}
              onBindingChanged={onBindingChanged}
            />
          </div>
        ) : (
          <EmptyState
            icon={MousePointerClick}
            title="キーを選択"
            description="キーマップ上のキーをクリックすると、ここで動作を変更できます"
            className="py-8"
          />
        )}
      </div>
    </div>
  );
}
