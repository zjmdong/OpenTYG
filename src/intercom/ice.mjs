import {isIP} from 'node:net';
import {Connection,Candidate,StunProtocol,Message,parseMessage,classes,methods,candidateFoundation,candidatePriority,serverReflexiveCandidate} from '../../vendor/ice/wrapper.mjs';

export function isStun(bytes){return bytes.length>=20&&(bytes[0]&0xc0)===0&&bytes.readUInt32BE(4)===0x2112a442;}
export function parseIce(sdp){let section=null;const session={candidates:[]},sections=[];
 for(const line of sdp.split(/\r?\n/)){if(line.startsWith('m=')){section={kind:line.slice(2).split(' ')[0],candidates:[],...Object.fromEntries(Object.entries(session).filter(([k])=>k!=='candidates'))};sections.push(section);}
 const item=section||session;if(line.startsWith('a=ice-ufrag:'))item.usernameFragment=line.slice(12);if(line.startsWith('a=ice-pwd:'))item.password=line.slice(10);if(line==='a=ice-lite')session.iceLite=true;
 if(line.startsWith('a=candidate:')){try{const c=Candidate.fromSdp(line.slice(12));if(c.transport.toLowerCase()==='udp'&&isIP(c.host)===4&&c.port>0&&c.port<=65535&&[1,2].includes(c.component)&&item.candidates.length<64)item.candidates.push(c);}catch{}}
 }return sections.map(item=>({...item,iceLite:!!session.iceLite}));}

/** Bind the pinned ICE engine to our advertised RTP/RTCP sockets.
 * The adapter accesses version-pinned Connection protocol hooks because its
 * public gatherer allocates new sockets. All checks/roles/nomination/consent and
 * TURN transactions remain in the verified upstream implementation.
 */
export class IceTransport {
 constructor({socket,ip,credentials,component=1,options={},onData=()=>{},onState=()=>{}}){
  this.socket=socket;this.ip=ip;this.component=component;this.onData=onData;this.onState=onState;this.enabled=false;this.closed=false;this.lastPeer=null;
  this.stats={state:'new',localCandidates:0,remoteCandidates:0,checksSent:0,responsesReceived:0,requestsReceived:0,consentRequestsSent:0,selectedLocalType:null,selectedRemoteType:null};
  this.connection=new Connection(true,{useIpv4:true,useIpv6:false,useTcp:false,...options});
  // The APK supplies no public STUN/TURN service. Never silently contact Google.
  this.connection.stunServer=options.stunServer;this.connection.turnServer=options.turnServer;
  if(credentials){this.connection.localUsername=credentials.usernameFragment;this.connection.localPassword=credentials.password;this.connection.userHistory={[credentials.usernameFragment]:credentials.password};}
  this.credentials={usernameFragment:this.connection.localUsername,password:this.connection.localPassword};
  const ensure=this.connection.ensureProtocol.bind(this.connection);
  this.connection.ensureProtocol=protocol=>{
   const execute=protocol.onRequestReceived.execute.bind(protocol.onRequestReceived);
   protocol.onRequestReceived.execute=(message,address,data)=>{
    if(!this.enabled||!parseMessage(data,Buffer.from(this.connection.localPassword)))return;
    if(message.getAttributeValue('USERNAME')!==this.connection.localUsername+':'+this.connection.remoteUsername)return;
    this.stats.requestsReceived++;execute(message,address,data);
   };
   ensure(protocol);
   protocol.onDataReceived.subscribe(data=>{const nominated=this.connection.nominated;if(!this.enabled||!['connected','completed'].includes(this.connection.state)||nominated?.protocol!==protocol)return;
    const peer=protocol===this.protocol?this.lastPeer:{address:nominated.remoteAddr[0],port:nominated.remoteAddr[1]};if(peer&&peer.address===nominated.remoteAddr[0]&&peer.port===nominated.remoteAddr[1])this.onData(data,peer);
   });
  };
  this.protocol=new StunProtocol();this.protocol.localIp=ip;
  this.protocol.transport={closed:false,address:{address:ip,port:socket.address().port},send:(bytes,address)=>new Promise((resolve,reject)=>{if(this.closed)return reject(new Error('MEDIA_CLOSED'));socket.send(bytes,address[1],address[0],e=>e?reject(e):resolve());}),close:async()=>{this.protocol.transport.closed=true;}};
  this.connection.ensureProtocol(this.protocol);this.connection.protocols.push(this.protocol);
  this.protocol.localCandidate=new Candidate(candidateFoundation('host','udp',ip),1,'udp',candidatePriority('host'),ip,socket.address().port,'host');
  if(!options.forceTurn)this.connection.localCandidates.push(this.protocol.localCandidate);
  this.listener=(bytes,peer)=>{this.lastPeer=peer;if(this.enabled||isStun(bytes))this.protocol.datagramReceived(bytes,[peer.address,peer.port]);};socket.on('message',this.listener);
  this.connection.stateChanged.subscribe(state=>{this.stats.state=this.enabled?state:'not-negotiated';this.onState(this.snapshot());});
 }
 async gather(){
  const connection=this.connection,promises=[];
  if(connection.stunServer&&!connection.options.forceTurn)promises.push(serverReflexiveCandidate(this.protocol,connection.stunServer).then(candidate=>{if(candidate)connection.localCandidates.push(candidate);}));
  // Empty host list preserves our sockets; upstream gathers configured TURN.
  if(connection.turnServer)promises.push(...connection.getCandidatePromises([],3));
  if(promises.length)await Promise.allSettled(promises);if(this.closed)return;
  connection.localCandidatesEnd=true;this.stats.localCandidates=connection.localCandidates.length;
 }
 sdpLines(){return [`a=ice-ufrag:${this.credentials.usernameFragment}`,`a=ice-pwd:${this.credentials.password}`,...this.connection.localCandidates.map(candidate=>{const value=Candidate.fromSdp(candidate.toSdp());value.component=this.component;return 'a=candidate:'+value.toSdp();}),'a=end-of-candidates'];}
 async start(remote){
  if(!remote?.usernameFragment||!remote.password){if(this.enabled){this.enabled=false;await this.reset();}this.stats.state='not-negotiated';return;}
  if(!/^[A-Za-z0-9+/]{4,256}$/.test(remote.usernameFragment)||! /^[A-Za-z0-9+/]{22,256}$/.test(remote.password))throw new Error('MEDIA_ICE_INVALID');
  const candidates=(remote.candidates||[]).filter(candidate=>candidate.component===this.component);
  if(!candidates.length)throw new Error('MEDIA_ICE_NO_CANDIDATE');
  if(this.enabled){if(this.connection.remoteUsername===remote.usernameFragment&&this.connection.remotePassword===remote.password)return;this.enabled=false;await this.reset();}
  this.enabled=true;this.connection.setRemoteParams(remote);
  for(const candidate of candidates){const c=Candidate.fromSdp(candidate.toSdp());c.component=1;await this.connection.addRemoteCandidate(c);}
  await this.connection.addRemoteCandidate(undefined);this.stats.remoteCandidates=candidates.length;this.stats.state='checking';this.onState(this.snapshot());
  const generation=this.connection.generation;this.connecting=this.connection.connect().catch(()=>{if(!this.closed&&this.enabled&&this.connection.generation===generation){this.stats.state='failed';this.onState(this.snapshot());}});
 }
 async stopChecks(){for(const pair of this.connection.candidatePairs)pair.handle?.resolve?.();this.connection.checkList=[];this.connection.checkListDone=true;this.connection.checkListState.put(2);await this.connecting;}
 async reset(){const candidates=[...this.connection.localCandidates];await this.stopChecks();await this.connection.restart();this.connection.localUsername=this.credentials.usernameFragment;this.connection.localPassword=this.credentials.password;this.connection.userHistory={[this.credentials.usernameFragment]:this.credentials.password};for(const candidate of candidates){candidate.generation=this.connection.generation;candidate.ufrag=this.credentials.usernameFragment;}this.connection.localCandidates=candidates;this.connection.localCandidatesEnd=true;}
 peer(){const pair=this.connection.nominated;return pair&&['connected','completed'].includes(this.connection.state)?{address:pair.remoteAddr[0],port:pair.remoteAddr[1]}:null;}
 send(bytes){if(!this.enabled||this.closed)return false;this.connection.send(bytes).catch(()=>{});return true;}
 snapshot(){const pair=this.connection.nominated;return {...this.stats,state:this.enabled&&this.stats.state!=='failed'?this.connection.state:this.stats.state,checksSent:this.connection.candidatePairs.reduce((n,p)=>n+p.requestsSent,0),responsesReceived:this.connection.candidatePairs.reduce((n,p)=>n+p.responsesReceived,0),consentRequestsSent:pair?.consentRequestsSent||0,selectedLocalType:pair?.localCandidate.type||null,selectedRemoteType:pair?.remoteCandidate.type||null};}
 async close(){if(this.closed)return;this.closed=true;this.enabled=false;this.socket.off('message',this.listener);await this.stopChecks();await this.connection.close().catch(()=>{});}
}

export function bindingResponse(request,peer){const message=parseMessage(request);if(message?.messageMethod!==methods.BINDING||message.messageClass!==classes.REQUEST||message.getAttributeValue('USERNAME'))return null;return new Message(methods.BINDING,classes.RESPONSE,message.transactionId).setAttribute('XOR-MAPPED-ADDRESS',[peer.address,peer.port]).addFingerprint().bytes;}
