import dgram from 'node:dgram';
import { resolveSip,physicalAddress,isFakeIp } from './network.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { RtpMedia } from './media.mjs';

const id = () => randomBytes(10).toString('hex');
const md5 = s => createHash('md5').update(s).digest('hex');
const fail = code => Object.assign(new Error(code),{code});
export function parseSip(bytes) {
  const text=bytes.toString('utf8'), offset=text.indexOf('\r\n\r\n');if(offset<0)return null;
  const [first,...lines]=text.slice(0,offset).replace(/\r\n[ \t]+/g,' ').split('\r\n');
  const headers={}; for(const line of lines){const i=line.indexOf(':');if(i<1)continue;let k=line.slice(0,i).trim().toLowerCase();k=({v:'via',f:'from',t:'to',i:'call-id',m:'contact',l:'content-length',c:'content-type'})[k]||k;(headers[k]??=[]).push(line.slice(i+1).trim());}
  const status=Number(first.match(/^SIP\/2.0 (\d+)/)?.[1])||null;
  return {first,status,method:status?null:first.split(' ')[0],headers,body:text.slice(offset+4),get:k=>headers[k.toLowerCase()]?.[0]||''};
}
export function digestHeader(challenge,{username,password,method,uri,nc=1}) {
  if(!/^Digest /i.test(challenge))throw fail('SIP_AUTH_UNSUPPORTED');
  const p={};for(const m of challenge.slice(7).matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g))p[m[1].toLowerCase()]=m[2]??m[3];
  if(!p.realm||!p.nonce||!['MD5','MD5-SESS'].includes((p.algorithm||'MD5').toUpperCase()))throw fail('SIP_AUTH_UNSUPPORTED');
  const qop=p.qop?.split(',').map(v=>v.trim());if(qop&&!qop.includes('auth'))throw fail('SIP_AUTH_UNSUPPORTED');
  const cnonce=id(), count=nc.toString(16).padStart(8,'0');let ha1=md5(`${username}:${p.realm}:${password}`);
  if(p.algorithm?.toUpperCase()==='MD5-SESS')ha1=md5(`${ha1}:${p.nonce}:${cnonce}`);
  const ha2=md5(`${method}:${uri}`),response=qop?md5(`${ha1}:${p.nonce}:${count}:${cnonce}:auth:${ha2}`):md5(`${ha1}:${p.nonce}:${ha2}`);
  const quote=s=>String(s).replace(/["\\]/g,'\\$&');
  return 'Digest '+Object.entries({username,realm:p.realm,nonce:p.nonce,uri,response,...(p.opaque?{opaque:p.opaque}:{})}).map(([k,v])=>`${k}="${quote(v)}"`).join(', ')+`, algorithm=${p.algorithm||'MD5'}`+(qop?`, qop=auth, nc=${count}, cnonce="${cnonce}"`:p.algorithm?.toUpperCase()==='MD5-SESS'?`, cnonce="${cnonce}"`:'');
}
const uriOf = header => header.match(/<([^>]+)>/)?.[1] || header.split(';')[0].trim();
// Route/Record-Route can contain several entries in one header line.
export function splitRoutes(values=[]) {
  return values.flatMap(value=>{const routes=[];let start=0,quoted=false,angle=0;
    for(let i=0;i<value.length;i++){const c=value[i];if(c==='"'&&value[i-1]!=='\\')quoted=!quoted;
      if(!quoted){if(c==='<')angle++;if(c==='>')angle--;if(c===','&&!angle){routes.push(value.slice(start,i).trim());start=i+1;}}}
    routes.push(value.slice(start).trim());return routes.filter(Boolean);});
}
export function addressClass(address) {
  const n=String(address).split('.').map(Number);
  if(n.length!==4||n.some(v=>!Number.isInteger(v)||v<0||v>255))return 'unknown';
  if(n[0]===0)return 'unspecified';
  if(n[0]===127)return 'loopback';
  if(n[0]===198&&[18,19].includes(n[1]))return 'virtual';
  if(n[0]===10||n[0]===192&&n[1]===168||n[0]===172&&n[1]>=16&&n[1]<=31)return 'local';
  return 'public';
}
export class SipAgent extends EventEmitter {
  constructor(config,{transactionTimeoutMs=32000,callTimeoutMs=60000,instanceId=randomUUID(),mediaOptions={}}={}) {
    super();this.config=config;this.transactionTimeoutMs=transactionTimeoutMs;this.callTimeoutMs=callTimeoutMs;
    this.state={registered:false,registration:'idle',call:null,media:null,errorCode:null};this.transactions=new Map();this.closed=false;this.cseq=0;this.registerId=randomUUID();this.tag=id();this.uuid=instanceId;
    this.registrationExpires=50;this.serviceRoutes=[];this.mediaOptions=mediaOptions;this.resetSignaling();
  }
  resetSignaling(){this.signaling={transport:'UDP',phase:'idle',localAddressClass:this.ip?addressClass(this.ip):'unknown',proxyAddressClass:this.proxyIP?addressClass(this.proxyIP):'unknown',proxyPort:this.config.port||null,sentPackets:0,receivedPackets:0,matchedResponses:0,ignoredPackets:0,authChallenges:0,timeoutCount:0,lastStatus:null,failureStage:null,networkErrorCode:null,registerAorValid:false,registrationExpires:this.registrationExpires,natContactRewrites:0,serviceRouteCount:this.serviceRoutes.length,trace:[]};this.traceStart=Date.now();}
  trace(direction,method,status=null){this.signaling.trace.push({elapsedMs:Date.now()-this.traceStart,direction,method,status});if(this.signaling.trace.length>24)this.signaling.trace.shift();}
  snapshot(){const stats=this.media?.stats||this.state.media?.stats;return {...this.state,signaling:{...this.signaling,trace:this.signaling.trace.map(t=>({...t}))},call:this.state.call?{...this.state.call,remoteBye:this.state.call.remoteBye?{...this.state.call.remoteBye}:null}:null,media:this.state.media?{...this.state.media,ice:this.media?.iceSnapshot()||this.state.media.ice,stats:stats?{...stats,audioPayloadsSeen:[...(stats.audioPayloadsSeen||[])]}:undefined}:null};}
  update(part){Object.assign(this.state,part);this.emit('state',this.snapshot());}
  async init(){if(this.socket)return;
    this.signaling.phase='resolving';
    const resolved=await resolveSip(this.config.proxy);const answers=resolved.answers;this.signaling.dnsResolution=resolved.resolution;if(this.closed)throw fail('SIP_CLOSED');
    this.proxyIP=answers[0].address;this.proxyIPs=new Set(answers.map(a=>a.address));this.signaling.proxyAddressClass=addressClass(this.proxyIP);this.signaling.phase='binding';
    // A connected UDP socket discards replies from any other source port. SIP
    // transaction matching is done below; receive from the configured proxy IPs.
    // The probe selects the actual OS route without sending an application packet.
    const probe=dgram.createSocket('udp4');
    try{await new Promise((r,j)=>{probe.once('error',j);probe.connect(this.config.port,this.proxyIP,r);});this.ip=probe.address().address;}finally{try{probe.close();}catch{}}
    if(isFakeIp(this.ip)){const physical=physicalAddress();if(!physical)throw fail('SIP_NETWORK_ERROR');this.ip=physical;this.signaling.virtualRouteAdjusted=true;}
    if(this.closed)throw fail('SIP_CLOSED');if(addressClass(this.ip)==='unspecified')throw fail('SIP_NETWORK_ERROR');
    const socket=dgram.createSocket('udp4');socket.on('message',(b,peer)=>this.receive(b,peer));socket.on('error',e=>this.networkFailure(e));
    try{await new Promise((r,j)=>{socket.once('error',j);socket.bind(0,this.ip,()=>{socket.removeListener('error',j);r();});});}catch(e){try{socket.close();}catch{}throw e;}
    if(this.closed){socket.close();throw fail('SIP_CLOSED');}this.socket=socket;this.port=socket.address().port;this.signaling.localAddressClass=addressClass(this.ip);
    this.contact=`<sip:${this.config.account}@${this.ip}:${this.port};transport=udp>`;
  }
  networkFailure(error){if(this.closed)return;
    this.signaling.networkErrorCode=/^(?:E[A-Z0-9_]+|ERR_SOCKET_[A-Z_]+)$/.test(error?.code||'')?error.code:'UDP_ERROR';
    this.update({registered:false,registration:'failed',errorCode:'SIP_NETWORK_ERROR'});for(const key of this.transactions.keys())this.finish(key,fail('SIP_NETWORK_ERROR'));
  }
  make(method,uri,{callId=this.registerId,from=`<sip:${this.config.account}@${this.config.domain}>;tag=${this.tag}`,to=`<${uri}>`,cseq=++this.cseq,branch='z9hG4bK'+id(),headers={},body=''}={}){
    const logicalUri=uri,h={Via:`SIP/2.0/UDP ${this.viaAddress||this.ip}:${this.viaPort||this.port};rport;branch=${branch}`,'Max-Forwards':'70',From:from,To:to,'Call-ID':callId,CSeq:`${cseq} ${method}`,Contact:this.contact,
      Route:[`<sip:${this.config.proxy}:${this.config.port};lr>`,...(method==='REGISTER'?[]:this.serviceRoutes)],'User-Agent':'TYG-Browser-Prototype/0.3.4',...headers,'Content-Length':Buffer.byteLength(body)};
    // RFC 3261 §12.2.1.1: support strict routers in a server-provided route set.
    const routes=splitRoutes(Array.isArray(h.Route)?h.Route:[h.Route]);if(routes[0]&&!/;lr(?:[;>\s]|$)/i.test(uriOf(routes[0]))){h.Route=[...routes.slice(1),`<${uri}>`];uri=uriOf(routes[0]);}
    return {method,uri,logicalUri,callId,from,to,cseq,branch,body,extraHeaders:headers,routes,wire:`${method} ${uri} SIP/2.0\r\n`+Object.entries(h).flatMap(([k,v])=>(Array.isArray(v)?v:[v]).map(s=>`${k}: ${s}\r\n`)).join('')+'\r\n'+body};
  }
  registerRequest(expires=this.registrationExpires,headers={}){const aor=`<sip:${this.config.account}@${this.config.domain}>`;
    const req=this.make('REGISTER',`sip:${this.config.domain}`,{to:aor,headers:{Expires:String(expires),SPSToken:this.uuid,...headers}});
    this.signaling.registerAorValid=req.to===aor&&req.from.startsWith(aor+';tag=');return req;
  }
  send(req){if(this.closed||!this.socket)throw fail('SIP_CLOSED');this.signaling.sentPackets++;this.trace('sent',req.method);this.socket.send(Buffer.from(req.wire),this.config.port,this.proxyIP,e=>{if(e)this.networkFailure(e);});}
  transaction(req,onProgress){return new Promise((resolve,reject)=>{
    let delay=500;const key=req.branch+'|'+req.method;
    const tx={req,resolve,reject,onProgress,provisional:false};this.transactions.set(key,tx);
    const retry=()=>{if(this.closed)return;if(!(req.method==='INVITE'&&tx.provisional))this.send(req);delay=Math.min(delay*2,4000);tx.retry=setTimeout(retry,delay);};
    tx.timer=setTimeout(()=>{this.signaling.timeoutCount++;this.finish(key,fail('SIP_TIMEOUT'));},req.method==='INVITE'?this.callTimeoutMs+1000:this.transactionTimeoutMs);
    try{this.send(req);tx.retry=setTimeout(retry,delay);}catch(e){this.finish(key,e);}
  });}
  finish(key,error,response){const tx=this.transactions.get(key);if(!tx)return;clearTimeout(tx.timer);clearTimeout(tx.retry);this.transactions.delete(key);error?tx.reject(error):tx.resolve(response);}
  receive(bytes,peer){this.signaling.receivedPackets++;
    if(peer&&!this.proxyIPs?.has(peer.address)){this.signaling.ignoredPackets++;return;}
    const r=parseSip(bytes);if(!r){this.signaling.ignoredPackets++;return;}
    if(r.status){const branch=r.get('via').match(/(?:^|;)\s*branch\s*=\s*([^;\s]+)/i)?.[1],sequence=r.get('cseq').match(/^(\d+)\s+(\w+)$/),method=sequence?.[2];const key=branch+'|'+method,tx=this.transactions.get(key);
      if(tx&&r.get('call-id')===tx.req.callId&&Number(sequence[1])===tx.req.cseq){this.signaling.matchedResponses++;this.signaling.lastStatus=r.status;this.trace('received',method,r.status);if(method==='REGISTER'&&r.status===200&&peer)this.registrationPeer={...peer};if(r.status<200){tx.provisional=true;tx.onProgress?.(r);return;}this.finish(key,null,r);}
      // 2xx retransmissions after the INVITE transaction ended still need an ACK.
      else if(method==='INVITE'&&r.status>=200&&r.status<300&&this.dialog?.callId===r.get('call-id')&&Number(sequence?.[1])===this.dialog.invite?.cseq)this.ack(r,this.dialog.invite,true);
      else this.signaling.ignoredPackets++;
      return;
    }
    const same=this.dialog?.callId===r.get('call-id');this.trace('received',r.method);
    if(r.method==='BYE'&&same){const reason=r.get('reason').match(/(?:^|,)\s*(SIP|Q\.850)\s*;\s*cause\s*=\s*(\d+)/i);if(this.state.call)this.state.call.remoteBye=reason?{protocol:reason[1].toUpperCase(),cause:Number(reason[2])}:null;this.respond(r,200,'OK',peer);this.end('remote-hangup');}
    else if(r.method==='OPTIONS')this.respond(r,200,'OK',peer);
    else if(['INVITE','UPDATE'].includes(r.method)&&same)this.renegotiate(r,peer).catch(()=>this.respond(r,488,'Not Acceptable Here',peer));
    else if(r.method==='INVITE')this.respond(r,486,'Busy Here',peer);
    else if(r.method!=='ACK')this.respond(r,481,'Call/Transaction Does Not Exist',peer);
  }
  respond(r,status,reason,peer,body='',extra={}){this.trace('sent',r.method,status);const h={Via:r.headers.via,From:r.get('from'),To:r.get('to')+(r.get('to').includes('tag=')?'':`;tag=${id()}`),'Call-ID':r.get('call-id'),CSeq:r.get('cseq'),...extra,'Content-Length':Buffer.byteLength(body)};this.socket?.send(Buffer.from(`SIP/2.0 ${status} ${reason}\r\n`+Object.entries(h).flatMap(([k,v])=>(Array.isArray(v)?v:[v]).map(s=>`${k}: ${s}\r\n`)).join('')+'\r\n'+body),peer?.port||this.config.port,peer?.address||this.proxyIP,e=>{if(e)this.networkFailure(e);});}
  async renegotiate(r,peer){if(!this.dialog?.confirmed||!this.media)return this.respond(r,491,'Request Pending',peer);const sequence=r.get('cseq'),number=Number(sequence.match(/^(\d+)\s+/)?.[1]);if(!Number.isSafeInteger(number))return this.respond(r,400,'Bad Request',peer);const last=this.dialog.lastRemoteOffer;if(last?.sequence===sequence)return this.respond(r,200,'OK',peer,last.answer,last.extra);if(last&&number<=last.number)return this.respond(r,500,'CSeq Out of Order',peer);if(this.renegotiating)return this.respond(r,491,'Request Pending',peer);this.renegotiating=true;try{let answer='';if(r.body){if(!/application\/sdp/i.test(r.get('content-type')))return this.respond(r,415,'Unsupported Media Type',peer);answer=this.media.answer(r.body);await this.media.negotiate(r.body);this.update({media:this.media.description});}else if(r.method==='INVITE')return this.respond(r,488,'Not Acceptable Here',peer);const extra=answer?{'Content-Type':'application/sdp',Contact:this.contact}:{};this.dialog.lastRemoteOffer={sequence,number,answer,extra};this.respond(r,200,'OK',peer,answer,extra);}finally{this.renegotiating=false;}}
  learnMapping(r){const received=r.get('via').match(/(?:^|;)\s*received\s*=\s*([^;\s]+)/i)?.[1],rport=Number(r.get('via').match(/(?:^|;)\s*rport\s*=\s*(\d+)/i)?.[1]);
    const type=addressClass(received);if(!received||['unknown','unspecified'].includes(type)||!Number.isInteger(rport)||rport<1||rport>65535)return null;
    const next=`<sip:${this.config.account}@${received}:${rport};transport=udp>`;if(next===this.contact)return null;
    // Preserve PJSUA's guard against replacing a public address with a private one.
    if(['local','loopback'].includes(type)&&(addressClass(this.ip)==='public'||received===(this.viaAddress||this.ip)))return null;
    const old=this.contact;this.contact=next;this.viaAddress=received;this.viaPort=rport;this.signaling.natContactRewrites++;return old;
  }
  async authenticate(req,onProgress){let r=await this.transaction(req,onProgress);
    for(let attempt=0;[401,407].includes(r.status)&&attempt<2;attempt++){
      this.signaling.authChallenges++;if(req.method==='REGISTER')this.signaling.phase='authenticating';
      if(req.method==='INVITE')this.ack(r,req,false);
      const proxy=r.status===407,authorization=digestHeader(r.get(proxy?'proxy-authenticate':'www-authenticate'),{username:this.config.account,password:this.config.password,method:req.method,uri:req.uri});
      if(req.method==='INVITE'&&this.dialog?.cancelled)return {response:r,request:req};
      const mapping=req.method==='REGISTER'&&this.learnMapping(r);
      const original=req;req=this.make(req.method,req.logicalUri,{callId:req.callId,from:req.from,to:req.to,body:req.body,headers:{...req.extraHeaders,...(mapping?{Contact:this.contact}:{}),[proxy?'Proxy-Authorization':'Authorization']:authorization}});
      if(this.dialog?.invite===original)this.dialog.invite=req;
      r=await this.transaction(req,onProgress);
    }
    return {response:r,request:req};
  }
  async register(){if(this.closed)throw fail('SIP_CLOSED');if(this.state.registered)return this.snapshot();if(this.registering)throw fail('INTERCOM_BUSY');
    this.registering=true;if(!this.socket)this.resetSignaling();this.update({registration:'registering',errorCode:null});
    try{await this.init();clearTimeout(this.refresh);this.signaling.phase='waiting-response';let r,contacts;
      // Bounded renegotiation for Min-Expires and NAT Contact repair. Never calls a device.
      for(let round=0;round<4;round++){
        ({response:r}=await this.authenticate(this.registerRequest(this.registrationExpires,contacts?{Contact:contacts}:{})));
        if(r.status===423){const minimum=Number(r.get('min-expires'));if(!Number.isInteger(minimum)||minimum<=this.registrationExpires||minimum>86400)throw fail('SIP_REGISTRATION_REJECTED');this.registrationExpires=minimum;this.signaling.registrationExpires=minimum;continue;}
        if(r.status<200||r.status>=300)throw fail([401,403,407].includes(r.status)?'SIP_AUTH_REJECTED':'SIP_REGISTRATION_REJECTED');
        // Via reports the SIP socket mapping, not the mapping of the RTP sockets.
        const oldContact=this.learnMapping(r);if(oldContact){if(round>=2)throw fail('SIP_REGISTRATION_REJECTED');contacts=[oldContact+';expires=0',this.contact];this.signaling.phase='contact-rewrite';continue;}
        contacts=null;break;
      }
      if(contacts||!r||r.status<200||r.status>=300)throw fail('SIP_REGISTRATION_REJECTED');
      const entries=splitRoutes(r.headers.contact||[]),matching=entries.find(c=>uriOf(c)===uriOf(this.contact));
      const exp=Number(matching?.match(/;\s*expires\s*=\s*(\d+)/i)?.[1]||r.get('expires')||this.registrationExpires);if(!Number.isFinite(exp)||exp<=0)throw fail('SIP_REGISTRATION_REJECTED');
      const serviceRoutes=splitRoutes(r.headers['service-route']);if(serviceRoutes.some(route=>!/^sip:[^\s<>\r\n]+$/i.test(uriOf(route))))throw fail('SIP_ROUTE_UNSUPPORTED');this.serviceRoutes=serviceRoutes.slice(0,16);this.signaling.serviceRouteCount=this.serviceRoutes.length;
      this.signaling.registrationExpires=exp;this.signaling.phase='registered';this.update({registered:true,registration:'registered'});this.refresh=setTimeout(()=>{this.update({registered:false});this.register().catch(()=>{});},Math.max(1000,Math.min(exp*800,240000)));this.refresh.unref();
      if(!this.keepalive){this.keepalive=setInterval(()=>this.sendKeepalive(),15000);this.keepalive.unref();}return this.snapshot();
    }catch(e){this.signaling.failureStage=({resolving:'dns',binding:'socket','waiting-response':'initial-register',authenticating:'digest-register','contact-rewrite':'contact-rewrite'})[this.signaling.phase]||null;this.signaling.phase=this.closed?'closed':'failed';this.update({registered:false,registration:this.closed?'closed':'failed',errorCode:e.code||'SIP_NETWORK_ERROR'});throw e;}finally{this.registering=false;}
  }
  sendKeepalive(){if(this.state.registered&&!this.closed)this.socket?.send(Buffer.from('\r\n'),this.registrationPeer?.port||this.config.port,this.registrationPeer?.address||this.proxyIP,e=>{if(e)this.networkFailure(e);});}
  async call(device,{video=true,mode='talk'}={}){if(!['talk','monitor'].includes(mode))throw fail('INTERCOM_MODE_INVALID');if(mode==='monitor'&&!video)throw fail('INTERCOM_MODE_INVALID');if(!this.state.registered)throw fail('SIP_NOT_REGISTERED');if(this.dialog)throw fail('INTERCOM_BUSY');
    const callId=randomUUID(), uri=`sip:${device.number}@${this.config.domain}`;
    this.dialog={callId,uri,from:`<sip:${this.config.account}@${this.config.domain}>;tag=${id()}`,to:`<${uri}>`,device,cancelled:false,confirmed:false};
    this.earlyMediaPromise=null;this.update({call:{id:callId,deviceId:device.id,deviceName:device.name,mode,phase:'dialing',startedAt:Date.now(),ringingAt:null,answeredAt:null,endedAt:null,endReason:null,remoteBye:null},media:null,errorCode:null});
    try{const media=new RtpMedia((type,data)=>{if(this.media!==media)return;type==='control-state'?this.update({media:data}):this.emit(type,data);},{...this.mediaOptions,mode});this.media=media;const offer=await media.init(this.ip,video);
      if(!this.dialog||this.dialog.cancelled)throw fail('CALL_CANCELLED');
      const req=this.dialog.invite=this.make('INVITE',uri,{...this.dialog,body:offer,headers:{'Content-Type':'application/sdp',Allow:'INVITE, ACK, CANCEL, BYE, OPTIONS','Supported':'replaces'}});
      this.callTimer=setTimeout(()=>this.hangup().catch(()=>{}),this.callTimeoutMs);this.callTimer.unref();
      const {response:r,request:sent}=await this.authenticate(req,p=>{
        if(this.dialog){this.dialog.provisional=true;if(this.dialog.cancelled&&!this.dialog.cancelSent)this.cancelInvite().catch(()=>{});}
        if(this.state.call&&p.status>=180&&!this.dialog?.cancelled)this.update({call:{...this.state.call,ringingAt:this.state.call.ringingAt||Date.now(),phase:p.status===180?'ringing':'early-media'}});
        if(p.body&&/application\/sdp/i.test(p.get('content-type'))&&this.media){const media=this.media;this.earlyMediaPromise=(this.earlyMediaPromise||Promise.resolve()).then(()=>media.negotiate(p.body)).then(negotiated=>{if(this.media===media&&this.dialog)this.update({media:negotiated});}).catch(()=>{});}
      });
      if(r.status>=300){this.ack(r,sent,false);if(r.status===487||this.dialog?.cancelled){this.end('cancelled');return this.snapshot();}throw fail(r.status===486?'CALL_BUSY':r.status===480?'CALL_UNAVAILABLE':'CALL_REJECTED');}
      if(!this.dialog)return this.snapshot();this.dialog.invite=sent;this.dialog.to=r.get('to');this.dialog.target=uriOf(r.get('contact'))||uri;this.dialog.routes=splitRoutes(r.headers['record-route']).reverse();this.dialog.confirmed=true;
      this.ack(r,sent,true);clearTimeout(this.callTimer);
      if(this.dialog.cancelled){await this.hangup();return this.snapshot();}
      await this.earlyMediaPromise;this.earlyMediaPromise=null;if(!this.media||!this.dialog)return this.snapshot();const negotiated=r.body?await this.media.negotiate(r.body):this.media.description;if(!negotiated)throw fail('MEDIA_UNSUPPORTED');this.update({call:{...this.state.call,phase:'connected',answeredAt:Date.now()},media:negotiated});return this.snapshot();
    }catch(e){if(this.dialog?.confirmed)await this.hangup().catch(()=>{});this.end(e.code||'MEDIA_ERROR');throw e;}
  }
  ack(r,invite,success){const req=this.make('ACK',success?(this.dialog?.target||uriOf(r.get('contact'))||invite.logicalUri):invite.logicalUri,{callId:invite.callId,from:invite.from,to:r.get('to'),cseq:invite.cseq,...(!success?{branch:invite.branch}:{}),headers:{Route:success&&this.dialog?.routes?.length?this.dialog.routes:invite.routes}});this.send(req);}
  async hangup(){const d=this.dialog;if(!d)return this.snapshot();d.cancelled=true;
    if(d.confirmed){const req=this.make('BYE',d.target||d.uri,{callId:d.callId,from:d.from,to:d.to,headers:d.routes?.length?{Route:d.routes}:{}});try{const {response:r}=await this.authenticate(req);if(r.status>=300&&r.status!==481)throw fail('HANGUP_UNCONFIRMED');}finally{this.end('local-hangup');}}
    else if(d.invite){this.update({call:{...this.state.call,phase:'cancelling'}});if(d.provisional&&!d.cancelSent)await this.cancelInvite();}
    else this.end('cancelled');return this.snapshot();
  }
  cancelInvite(){const d=this.dialog;if(!d?.invite||d.cancelSent)return Promise.resolve();d.cancelSent=true;return this.transaction(this.make('CANCEL',d.invite.logicalUri,{...d.invite,body:'',cseq:d.invite.cseq,branch:d.invite.branch,headers:{Route:d.invite.routes}}));}
  end(reason){clearTimeout(this.callTimer);const finalMedia=this.state.media?{...this.state.media,stats:{...(this.media?.stats||this.state.media.stats)}}:null;this.media?.close();this.media=null;this.dialog=null;this.update({call:this.state.call?{...this.state.call,phase:'ended',endedAt:Date.now(),endReason:reason}:null,media:finalMedia});}
  async unregister(){clearTimeout(this.refresh);if(this.socket&&this.state.registered){try{await this.authenticate(this.registerRequest(0));this.state.registered=false;}catch{}}this.close();}
  close(){if(this.closed)return;clearInterval(this.keepalive);clearTimeout(this.refresh);clearTimeout(this.callTimer);
    const d=this.dialog;if(d?.invite&&this.socket){try{this.send(this.make(d.confirmed?'BYE':'CANCEL',d.confirmed?(d.target||d.uri):d.invite.uri,{callId:d.callId,from:d.from,to:d.to,...(!d.confirmed?{cseq:d.invite.cseq,branch:d.invite.branch}:{}),headers:d.confirmed&&d.routes?.length?{Route:d.routes}:{}}));}catch{}}
    if(this.state.registered&&this.socket){try{this.send(this.registerRequest(0));}catch{}}
    this.end('closed');for(const key of this.transactions.keys())this.finish(key,fail('SIP_CLOSED'));this.closed=true;this.signaling.phase='closed';try{this.socket?.close();}catch{}this.socket=null;this.config={};this.update({registered:false,registration:'closed'});}
}
