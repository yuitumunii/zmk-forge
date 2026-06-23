import type { ReactNode } from "react";
import {
  PhysicalLayout,
  Keymap as KeymapMsg,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type {
  GetBehaviorDetailsResponse,
  BehaviorParameterValueDescription,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import {
  LayoutZoom,
  PhysicalLayout as PhysicalLayoutComp,
} from "./PhysicalLayout";
import { HidUsageLabel } from "./HidUsageLabel";
import { hid_usage_page_and_id_from_usage } from "../hid-usages";

type BehaviorMap = Record<number, GetBehaviorDetailsResponse>;

type LayerRef = { id: number; name: string };

// Pick the descriptor that a concrete parameter value matches, so we know how
// to render it (a keycode vs. a layer vs. a named constant). Mirrors the
// matching logic the editor uses in behaviors/parameters.ts.
function matchDescriptor(
  value: number,
  descriptors: BehaviorParameterValueDescription[],
  layerIds: number[]
): BehaviorParameterValueDescription | undefined {
  return descriptors.find((v) => {
    if (v.constant !== undefined) return v.constant === value;
    if (v.range) return value >= v.range.min && value <= v.range.max;
    if (v.hidUsage) {
      const [page, id] = hid_usage_page_and_id_from_usage(value);
      return page !== 0 && id !== 0;
    }
    if (v.layerId) return layerIds.includes(value);
    if (v.nil) return value === 0;
    return false;
  });
}

// Render a single binding parameter as the right kind of label: a keycode
// through HidUsageLabel, a layer by its name, a constant by its name.
function ParamLabel({
  value,
  descriptors,
  layers,
}: {
  value: number;
  descriptors: BehaviorParameterValueDescription[];
  layers: LayerRef[];
}): ReactNode {
  const d = matchDescriptor(
    value,
    descriptors,
    layers.map((l) => l.id)
  );
  if (d?.layerId) {
    const layer = layers.find((l) => l.id === value);
    return <span>{layer?.name || `Layer ${value}`}</span>;
  }
  if (d?.constant !== undefined) {
    return <span>{d.name}</span>;
  }
  if (d?.range) {
    return <span>{value}</span>;
  }
  if (d?.nil) {
    return null;
  }
  // Default (and the explicit hidUsage case): a HID keycode.
  return <HidUsageLabel hid_usage={value} />;
}

export interface KeyLabelContent {
  header: string;
  children: ReactNode;
}

/**
 * 1キーの binding から { header, children } を返すユーティリティ関数。
 * Keyboard.tsx の tuningPositions など、Keymap コンポーネント外でも使えるよう export する。
 */
// eslint-disable-next-line react-refresh/only-export-components -- utility exported alongside component for use in Keyboard.tsx tuningPositions
export function getKeyLabelContent(
  binding: { behaviorId: number; param1: number; param2: number },
  behaviors: BehaviorMap,
  layers: LayerRef[]
): KeyLabelContent {
  const behavior = behaviors[binding.behaviorId];
  const metadata = behavior?.metadata ?? [];
  const layerIds = layers.map((l) => l.id);

  const param1Descriptors = metadata.flatMap((m) => m.param1 ?? []);
  const matchingSet = metadata.find((s) =>
    s.param1?.length
      ? matchDescriptor(binding.param1, s.param1, layerIds)
      : true
  );
  const param2Descriptors = matchingSet?.param2 ?? [];
  const hasMetadata = param1Descriptors.length > 0;

  const holdLabel = hasMetadata ? (
    <ParamLabel
      value={binding.param1}
      descriptors={param1Descriptors}
      layers={layers}
    />
  ) : (
    <HidUsageLabel hid_usage={binding.param1} />
  );
  const tapLabel =
    param2Descriptors.length > 0 ? (
      <ParamLabel
        value={binding.param2}
        descriptors={param2Descriptors}
        layers={layers}
      />
    ) : null;

  return {
    header: behavior?.displayName || "Unknown",
    children: tapLabel ? (
      <div className="flex flex-col items-center justify-center leading-tight gap-0.5">
        <span className="font-medium">{tapLabel}</span>
        <span className="text-[0.7em] opacity-70">{holdLabel}</span>
      </div>
    ) : (
      holdLabel
    ),
  };
}

export interface KeymapProps {
  layout: PhysicalLayout;
  keymap: KeymapMsg;
  behaviors: BehaviorMap;
  scale: LayoutZoom;
  selectedLayerIndex: number;
  selectedKeyPosition: number | undefined;
  onKeyPositionClicked: (keyPosition: number) => void;
}

export const Keymap = ({
  layout,
  keymap,
  behaviors,
  scale,
  selectedLayerIndex,
  selectedKeyPosition,
  onKeyPositionClicked,
}: KeymapProps) => {
  if (!keymap.layers[selectedLayerIndex]) {
    return <></>;
  }

  const positions = layout.keys.map((k, i) => {
    if (i >= keymap.layers[selectedLayerIndex].bindings.length) {
      return {
        id: `${keymap.layers[selectedLayerIndex].id}-${i}`,
        header: "Unknown",
        x: k.x / 100.0,
        y: k.y / 100.0,
        width: k.width / 100,
        height: k.height / 100.0,
        children: <span></span>,
      };
    }

    const binding = keymap.layers[selectedLayerIndex].bindings[i];
    // Match how LayerPicker labels layers: the layer's name, or its index when
    // unnamed — so a hold label cross-references the layer list cleanly.
    const layerRefs: LayerRef[] = keymap.layers.map((l, idx) => ({
      id: l.id,
      name: l.name || idx.toString(),
    }));

    const { header, children } = getKeyLabelContent(binding, behaviors, layerRefs);

    return {
      id: `${keymap.layers[selectedLayerIndex].id}-${i}`,
      header,
      x: k.x / 100.0,
      y: k.y / 100.0,
      width: k.width / 100,
      height: k.height / 100.0,
      r: (k.r || 0) / 100.0,
      rx: (k.rx || 0) / 100.0,
      ry: (k.ry || 0) / 100.0,
      children,
    };
  });

  return (
    <PhysicalLayoutComp
      positions={positions}
      oneU={48}
      hoverZoom={true}
      zoom={scale}
      selectedPosition={selectedKeyPosition}
      onPositionClicked={onKeyPositionClicked}
    />
  );
};
