/**
 * Telling Amber what this machine is and what it can do.
 *
 * The two calls belong together and were hand-written in three places before this. They
 * are not interchangeable: `register` re-declares the conversation tools and `announce`
 * re-declares the device capabilities, and Amber refuses any action a device did not
 * announce — so doing only one leaves half the surface stale with nothing reporting it.
 *
 * Takes the bridge rather than reaching for one, because the two callers hold it
 * differently: `index.ts` owns a nullable module-scoped instance, `ipc.ts` receives a
 * non-null one as a parameter. Accepting null here is what lets both call the same
 * function instead of keeping the pair spelled out twice.
 *
 * Deliberately *not* used by the device-rename path, which needs the announce alone —
 * a new name changes no tool spec, and calling this there would put a `register_tools`
 * on the wire to say nothing.
 */

import { app } from 'electron'

import { getDeviceId, getDeviceName } from '../device'
import type { ToolBridge } from './tool-bridge'

export function declareSelf(bridge: ToolBridge | null | undefined): void {
  bridge?.register()
  bridge?.announce(getDeviceId(), getDeviceName(), app.getVersion())
}
