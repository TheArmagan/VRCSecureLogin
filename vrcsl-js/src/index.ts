/** vrcsl.js — Official client SDK for VRCSecureLogin. */

// Core
export { VRCSLClient } from "./client";
export type { VRCSLClientOptions, VRChatBridgeOptions } from "./client";

// Results & types
export type {
  RegisterResult,
  RefreshResult,
  AccountInfo,
  ApiResponse,
  BatchRequest,
  BatchResponse,
  SubscribeResult,
  EventPayload,
  VRChatFetch,
  VRChatPackageConfig,
} from "./types";

// Error
export { VRCSLError } from "./error";

// Token Storage
export type { TokenStore } from "./token-store";
export { LocalStorageStore, MemoryStore, JsonFileStore } from "./token-store";

// Constants
export { Scopes } from "./scopes";

// DeepLink
export { DeepLink } from "./deeplink";

// Logger
export type { Logger } from "./logger";

// Events
export type { VRCSLEvent, PipelineEvent, LifecycleEvent } from "./events";

// Version
export const version = "1.0.0";

// UMD global alias — when loaded via IIFE, `VRCSL.Client` is more ergonomic
export { VRCSLClient as Client } from "./client";
