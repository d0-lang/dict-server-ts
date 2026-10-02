import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { Layer, Path } from "effect"

export const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, Path.layer)
