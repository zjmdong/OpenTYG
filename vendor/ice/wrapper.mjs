import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// ICE debug output includes authentication secrets in upstream debug calls.
// Disable only these namespaces, even when a developer set DEBUG=*.
const debug=require('debug');
debug.enable([process.env.DEBUG||'', '-werift-ice*','-werift-common*'].filter(Boolean).join(','));
const ice=require('werift-ice');
export const {Connection,Candidate,StunProtocol,Message,parseMessage,classes,methods,candidateFoundation,candidatePriority,serverReflexiveCandidate}=ice;
