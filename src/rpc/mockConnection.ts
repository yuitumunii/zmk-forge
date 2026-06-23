// A mock RpcConnection that emulates a ZMK device entirely in JS, so the editor
// works with no hardware ("Demo" mode). It plugs in at the same level the app
// already uses (call_rpc reads/writes Request/Response objects), bypassing the
// protobuf byte transport. See DEVELOPMENT.md.

import type { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";
import type {
  Request,
  RequestResponse,
  Notification,
} from "@zmkfirmware/zmk-studio-ts-client/studio";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import {
  SetLayerBindingResponse,
  type Keymap,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";

import {
  buildDemoKeymap,
  DEMO_BEHAVIORS,
  DEMO_DEVICE_INFO,
  DEMO_LAYOUTS,
} from "../demo/demoData";
import {
  GESTURE_SUBSYSTEM_ID,
  GESTURE_SUBSYSTEM_INDEX,
  handleGestureCall,
  resetGestureFirmware,
} from "../demo/demoGestureFirmware";

export function createMockConnection(): RpcConnection {
  let keymap: Keymap = buildDemoKeymap();
  let savedKeymap: Keymap = structuredClone(keymap);
  let unsaved = false;
  resetGestureFirmware();

  function handle(req: Request): Omit<RequestResponse, "requestId"> {
    // --- core ---
    if (req.core) {
      const c = req.core;
      if (c.getDeviceInfo) return { core: { getDeviceInfo: DEMO_DEVICE_INFO } };
      if (c.getLockState)
        return {
          core: { getLockState: LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED },
        };
      if (c.resetSettings) {
        keymap = buildDemoKeymap();
        savedKeymap = structuredClone(keymap);
        unsaved = false;
        return { core: { resetSettings: true } };
      }
    }

    // --- behaviors ---
    if (req.behaviors) {
      const b = req.behaviors;
      if (b.listAllBehaviors)
        return {
          behaviors: {
            listAllBehaviors: { behaviors: DEMO_BEHAVIORS.map((d) => d.id) },
          },
        };
      if (b.getBehaviorDetails) {
        const id = b.getBehaviorDetails.behaviorId;
        const details = DEMO_BEHAVIORS.find((d) => d.id === id);
        if (details) return { behaviors: { getBehaviorDetails: details } };
      }
    }

    // --- keymap ---
    if (req.keymap) {
      const k = req.keymap;
      if (k.getKeymap) return { keymap: { getKeymap: keymap } };
      if (k.getPhysicalLayouts)
        return { keymap: { getPhysicalLayouts: DEMO_LAYOUTS } };
      if (k.checkUnsavedChanges)
        return { keymap: { checkUnsavedChanges: unsaved } };
      if (k.setLayerBinding) {
        const { layerId, keyPosition, binding } = k.setLayerBinding;
        const layer = keymap.layers.find((l) => l.id === layerId);
        if (layer && binding && keyPosition < layer.bindings.length) {
          layer.bindings[keyPosition] = { ...binding };
          unsaved = true;
        }
        return {
          keymap: {
            setLayerBinding: SetLayerBindingResponse.SET_LAYER_BINDING_RESP_OK,
          },
        };
      }
      if (k.saveChanges) {
        savedKeymap = structuredClone(keymap);
        unsaved = false;
        return { keymap: { saveChanges: { ok: true } } };
      }
      if (k.discardChanges) {
        keymap = structuredClone(savedKeymap);
        unsaved = false;
        return { keymap: { discardChanges: true } };
      }
    }

    // --- custom subsystems (pyuron_gesture: live gesture tuning + dynamic
    //     per-layer gesture assignment) ---
    if (req.custom) {
      const cu = req.custom;
      if (cu.listCustomSubsystems) {
        return {
          custom: {
            listCustomSubsystems: {
              subsystems: [
                { index: GESTURE_SUBSYSTEM_INDEX, identifier: GESTURE_SUBSYSTEM_ID, uiUrl: [] },
              ],
            },
          },
        };
      }
      if (cu.call) {
        return {
          custom: {
            call: {
              subsystemIndex: cu.call.subsystemIndex,
              payload: handleGestureCall(cu.call.payload),
            },
          },
        };
      }
    }

    // Unknown / unhandled request: empty response (call_rpc only needs the id).
    return {};
  }

  let respController: ReadableStreamDefaultController<RequestResponse>;
  const request_response_readable = new ReadableStream<RequestResponse>({
    start(controller) {
      respController = controller;
    },
  });

  const request_writable = new WritableStream<Request>({
    write(req) {
      respController.enqueue({ requestId: req.requestId, ...handle(req) });
    },
  });

  // Notifications: keep the stream open forever (closing it would make the app
  // treat the device as disconnected). Cancelled via the abort signal on
  // disconnect by the caller.
  const notification_readable = new ReadableStream<Notification>({});

  return {
    label: "Demo",
    request_response_readable,
    request_writable,
    notification_readable,
    current_request: 0,
  };
}
