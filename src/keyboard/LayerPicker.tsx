import { Pencil, Minus, Plus } from "lucide-react";
import { Input, UiButton, IconButton } from "../misc/ui";
import { useCallback, useMemo, useState } from "react";
import {
  DropIndicator,
  Label,
  ListBox,
  ListBoxItem,
  Selection,
  useDragAndDrop,
} from "react-aria-components";
import { useModalRef } from "../misc/useModalRef";
import { GenericModal } from "../GenericModal";

interface Layer {
  id: number;
  name?: string;
}

export type LayerClickCallback = (index: number) => void;
export type LayerMovedCallback = (index: number, destination: number) => void;

interface LayerPickerProps {
  layers: Array<Layer>;
  selectedLayerIndex: number;
  canAdd?: boolean;
  canRemove?: boolean;

  onLayerClicked?: LayerClickCallback;
  onLayerMoved?: LayerMovedCallback;
  onAddClicked?: () => void | Promise<void>;
  onRemoveClicked?: () => void | Promise<void>;
  onLayerNameChanged?: (
    id: number,
    oldName: string,
    newName: string
  ) => void | Promise<void>;
}

interface EditLabelData {
  id: number;
  name: string;
}

const EditLabelModal = ({
  open,
  onClose,
  editLabelData,
  handleSaveNewLabel,
}: {
  open: boolean;
  onClose: () => void;
  editLabelData: EditLabelData;
  handleSaveNewLabel: (
    id: number,
    oldName: string,
    newName: string | null
  ) => void;
}) => {
  const ref = useModalRef(open);
  const [newLabelName, setNewLabelName] = useState(editLabelData.name);

  const handleSave = () => {
    handleSaveNewLabel(editLabelData.id, editLabelData.name, newLabelName);
    onClose();
  };

  return (
    <GenericModal
      ref={ref}
      onClose={onClose}
      className="min-w-min w-[30vw] flex flex-col"
    >
      <span className="mb-3 text-2xs font-semibold tracking-wide text-muted uppercase">レイヤー名</span>
      <Input
        type="text"
        defaultValue={editLabelData.name}
        autoFocus
        onChange={(e) => setNewLabelName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSave();
          }
        }}
      />
      <div className="mt-4 flex justify-end gap-2">
        <UiButton variant="ghost" size="sm" type="button" onClick={onClose}>
          キャンセル
        </UiButton>
        <UiButton variant="primary" size="sm" type="button" onClick={handleSave}>
          保存
        </UiButton>
      </div>
    </GenericModal>
  );
};

export const LayerPicker = ({
  layers,
  selectedLayerIndex,
  canAdd,
  canRemove,
  onLayerClicked,
  onLayerMoved,
  onAddClicked,
  onRemoveClicked,
  onLayerNameChanged,
  ...props
}: LayerPickerProps) => {
  const [editLabelData, setEditLabelData] = useState<EditLabelData | null>(
    null
  );

  const layer_items = useMemo(() => {
    return layers.map((l, i) => ({
      name: l.name || i.toLocaleString(),
      id: l.id,
      index: i,
      selected: i === selectedLayerIndex,
    }));
  }, [layers, selectedLayerIndex]);

  const selectionChanged = useCallback(
    (s: Selection) => {
      if (s === "all") {
        return;
      }

      onLayerClicked?.(layer_items.findIndex((l) => s.has(l.id)));
    },
    [onLayerClicked, layer_items]
  );

  const { dragAndDropHooks } = useDragAndDrop({
    renderDropIndicator(target) {
      return (
        <DropIndicator
          target={target}
          className={"data-[drop-target]:outline outline-1 outline-accent"}
        />
      );
    },
    getItems: (keys) =>
      [...keys].map((key) => ({ "text/plain": key.toLocaleString() })),
    onReorder(e) {
      const startIndex = layer_items.findIndex((l) => e.keys.has(l.id));
      const endIndex = layer_items.findIndex((l) => l.id === e.target.key);
      onLayerMoved?.(startIndex, endIndex);
    },
  });

  const handleSaveNewLabel = useCallback(
    (id: number, oldName: string, newName: string | null) => {
      if (newName !== null) {
        onLayerNameChanged?.(id, oldName, newName);
      }
    },
    [onLayerNameChanged]
  );

  return (
    <div className="flex flex-col min-w-44">
      <div className="flex items-center justify-between px-1 mb-1">
        <Label className="text-2xs font-semibold tracking-wide text-muted uppercase">レイヤー</Label>
        <div className="flex items-center gap-0.5">
          {onRemoveClicked && (
            <IconButton
              icon={Minus}
              size="sm"
              label="レイヤーを削除"
              disabled={!canRemove}
              onClick={onRemoveClicked}
            />
          )}
          {onAddClicked && (
            <IconButton
              icon={Plus}
              size="sm"
              label="レイヤーを追加"
              disabled={!canAdd}
              onClick={onAddClicked}
            />
          )}
        </div>
      </div>
      {editLabelData !== null && (
        <EditLabelModal
          open={editLabelData !== null}
          onClose={() => setEditLabelData(null)}
          editLabelData={editLabelData}
          handleSaveNewLabel={handleSaveNewLabel}
        />
      )}
      <ListBox
        aria-label="Keymap Layer"
        selectionMode="single"
        items={layer_items}
        disallowEmptySelection={true}
        selectedKeys={
          layer_items[selectedLayerIndex]
            ? [layer_items[selectedLayerIndex].id]
            : []
        }
        className="flex flex-col gap-0.5 cursor-pointer"
        onSelectionChange={selectionChanged}
        dragAndDropHooks={dragAndDropHooks}
        {...props}
      >
        {(layer_item) => (
          <ListBoxItem
            textValue={layer_item.name}
            className={[
              "relative group rounded-md px-2 py-1.5 text-sm transition-colors",
              "grid grid-cols-[1fr_auto] items-center",
              "aria-selected:bg-base-300",
              "hover:bg-base-300",
              "outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              "aria-selected:before:absolute aria-selected:before:left-0 aria-selected:before:top-1 aria-selected:before:bottom-1 aria-selected:before:w-0.5 aria-selected:before:rounded aria-selected:before:bg-primary",
            ].join(" ")}
          >
            <span className="text-base-content">{layer_item.name}</span>
            <button
              type="button"
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-base-200 text-muted hover:text-base-content"
              onClick={(e) => {
                e.stopPropagation();
                setEditLabelData({ id: layer_item.id, name: layer_item.name });
              }}
              aria-label="レイヤー名を編集"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </ListBoxItem>
        )}
      </ListBox>
    </div>
  );
};
