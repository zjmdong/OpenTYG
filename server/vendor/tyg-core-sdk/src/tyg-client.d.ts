export interface ClientOptions {
  allowInsecureTransport?: boolean; allowedHosts?: string[]; retainIntercomPassword?: boolean;
  origin?: string; timeZone?: string; lastLoginOs?: '2' | '3' | '4' | '5';
  deviceUniqueId?: string; lastLoginDeviceToken?: string;
  httpTimeoutMs?: number; connectTimeoutMs?: number; configTimeoutMs?: number;
  openTimeoutMs?: number; openCooldownMs?: number; fetchImpl?: typeof fetch;
}
export interface User { account: string; userAccount: string; name: string; loginType: 'sms' | 'password'; }
export interface Household {
  id: string; areaName: string; organizationSeq: string; householdSerial: string;
  householdAddress: string; mobile: string; valid: string; validityDescription: string;
  available: boolean; validEndDate: string; packageValidEndDate: string;
}
export interface Door {
  id: string; code: string; number: string; displayId: string; name: string;
  groupName: string; lockGroupName: string; source: 'group' | 'independent'; areaSerial: string;
  isExit: string; show: string; tempType: string; directionIndex: number;
}
export interface Credentials {
  authenticated: boolean; user: User | null; householdId: string | null;
  householdSerial: string | null; organizationSeq: string | null; mobile: string | null;
  connected: boolean; directoryId: string | null; redacted: boolean;
  tokens: { sessionToken: string | null; householdToken: string | null; authcode: string | null };
}
export interface Directory { householdId: string; directoryId: string; doors: Door[]; credentials: Credentials; }
export interface Configuration { origin: string; servers: { uums: string; cpsApi: string; htmlvdcs: string }; }
export interface Timing { operation: string; durationMs: number; errorCode: string | null; }
export interface ClientState {
  initialized: boolean; configuration: Configuration | null; credentials: Credentials;
  households: Household[]; directory: Directory | null; openRetryAfterMs: number; timings: Timing[]; intercom: IntercomState;
}
export interface IntercomDevice { id:string; number:string; name:string; areaSerial:string; areaName:string; type:string; status:string; monitorStatus:string; }
export interface IntercomCall { id:string; deviceId:string; deviceName:string; phase:'dialing'|'ringing'|'early-media'|'connected'|'cancelling'|'ended'; startedAt:number; ringingAt:number|null; answeredAt:number|null; endedAt:number|null; endReason:string|null; remoteBye:{protocol:'SIP'|'Q.850';cause:number}|null; }
export interface MediaStats {audioReceived:number;audioSent:number;videoReceived:number;videoFrames:number;dropped:number;mediaBindingSent:number;mediaBindingResponses:number;audioPacketsSeen:number;audioUnexpectedPayload:number;audioPayloadsSeen:number[];sourcePortChanges:number;rtcpSent:number;rtcpReceived:number;keyFrameRequests:number;microphoneFrames:number;microphoneActiveFrames:number;firstAudioMs:number|null;firstVideoPacketMs:number|null;firstVideoFrameMs:number|null;}
export interface IntercomSignaling {
  transport:'UDP'; phase:'idle'|'resolving'|'binding'|'waiting-response'|'authenticating'|'contact-rewrite'|'registered'|'failed'|'closed';
  localAddressClass:'unknown'|'unspecified'|'loopback'|'virtual'|'local'|'public'; proxyAddressClass:IntercomSignaling['localAddressClass']; proxyPort:number|null;
  sentPackets:number; receivedPackets:number; matchedResponses:number; ignoredPackets:number; authChallenges:number; timeoutCount:number; lastStatus:number|null;
  failureStage:'dns'|'socket'|'initial-register'|'digest-register'|'contact-rewrite'|null; networkErrorCode:string|null;
  registerAorValid:boolean; registrationExpires:number; natContactRewrites:number; serviceRouteCount:number;
  trace:{elapsedMs:number;direction:'sent'|'received';method:string;status:number|null}[];
}
export interface IntercomState {
  available:boolean; passwordRequired:boolean; configurationId:string|null; configVersion:string|null;
  devices:IntercomDevice[]; registered:boolean; registration:'idle'|'registering'|'registered'|'failed'|'closed';
  call:IntercomCall|null; errorCode:string|null;
  signaling:IntercomSignaling|null;
  media:{audioCodec:'PCMA'|'PCMU'; audioDirection:string; videoCodec:'H264'|null; videoDirection:string; audioRtcpMux:boolean;videoRtcpMux:boolean;stats:MediaStats}|null;
}
export interface IntercomCallInput { configurationId:string;deviceId:string;video?:boolean; }
export interface IntercomVideoFrame { key:boolean;timestamp:number;codec:string|null;bytes:Uint8Array; }
export type IntercomListener = (type:'state'|'audio'|'video',value:IntercomState|Uint8Array|IntercomVideoFrame)=>void;
export interface OpenInput { householdId: string; directoryId: string; doorId: string; }
export interface OpenResult {
  status: 'acknowledged' | 'rejected'; success: boolean; message: string;
  result: string; code: string; door: Pick<Door, 'id' | 'code' | 'number' | 'name'>; physicalStateVerified: false;
}
export class TygError extends Error {
  code: string; details: Record<string, unknown>; status: number;
  toJSON(): { code: string; message: string; details: Record<string, unknown> };
}
export const DEFAULT_ORIGIN: string;
export const ROUTES: Readonly<Record<string, string>>;
export function md5(value: string): string;
export function timestamp(ms?: number, timeZone?: string): string;
export function envelope(body: object, token?: string, ms?: number, timeZone?: string): object;
export function normalizeDoors(response: object): Door[];
export function detectImageContentType(bytes: Uint8Array): string | null;
export class TygClient {
  constructor(options?: ClientOptions);
  initialize(options?: { force?: boolean }): Promise<Configuration>;
  createCaptcha(mobile: string, options?: { refresh?: boolean; includeImage?: boolean }): Promise<{ challengeId: string; imageUrl: string; expiresIn: number; image?: { bytes: Uint8Array; contentType: string } }>;
  captchaImage(challengeId: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  sendSms(challengeId: string, picRandom: string): Promise<{ sent: true; code: string; retryAfterSeconds: number }>;
  loginSms(mobile: string, smsVerifyCode: string): Promise<{ user: User; sessionToken: string }>;
  loginPassword(account: string, password: string, changeDeviceSmsCode?: string): Promise<{ user: User; sessionToken: string }>;
  /** Contains secrets. Only pass to a trusted encrypted store; never log or return to a browser. */
  serializeLoginSession():Uint8Array;
  restoreLoginSession(bytes:Uint8Array):Promise<ClientState>;
  getHouseholds(): Promise<Household[]>;
  getDoorCredentials(householdId: string): Promise<Credentials>;
  getDoors(householdId: string): Promise<Directory>;
  getCredentials(options?: { includeSecrets?: boolean }): Credentials;
  getState(): ClientState;
  openDoor(input: OpenInput): Promise<OpenResult>;
  prepareIntercom(options?:{password?:string}):Promise<IntercomState>;
  registerIntercom():Promise<IntercomState>;
  getIntercomState():IntercomState;
  callIntercom(input:IntercomCallInput):IntercomState;
  hangupIntercom():Promise<IntercomState>;
  closeIntercom():void;
  onIntercomEvent(listener:IntercomListener):()=>void;
  writeIntercomAudio(pcm:Uint8Array):void;
  logout(): Promise<{ loggedOut: true }>;
  close(): void;
}
