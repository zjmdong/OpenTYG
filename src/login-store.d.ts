export interface SavedLoginStatus {saved:boolean;storage:'Windows DPAPI';}
/** Windows current-user DPAPI storage; never falls back to plaintext. */
export class WindowsLoginStore {
 constructor(options:{origin:string;mode?:string;directory?:string});
 status():Promise<SavedLoginStatus>;
 save(bytes:Uint8Array):Promise<SavedLoginStatus>;
 load():Promise<Uint8Array|null>;
 clear():Promise<SavedLoginStatus>;
}
