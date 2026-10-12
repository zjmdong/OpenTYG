import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import {IceTransport,parseIce,isStun,bindingResponse} from './ice.mjs';
export function decodeG711(byte, codec='PCMA') {
  if (codec==='PCMA') { byte^=0x55; let n=(byte&15)<<4, e=(byte>>4)&7; n+=e===0?8:0x108; if(e>1)n<<=e-1; return byte&128?n:-n; }
  byte=(~byte)&255; let n=((byte&15)<<3)+132; n<<=(byte>>4)&7; return byte&128?132-n:n-132;
}
export function encodeG711(n, codec='PCMA') {
  n=Math.max(-32768,Math.min(32767,n));
  if(codec==='PCMA') { let mask=n>=0?0xd5:0x55; n=n>=0?n:-n-1; n=Math.min(n,32767); let seg=0; for(let x=n>>8;x>0;x>>=1)seg++; const a=seg>=8?127:(seg<<4)|((n>>(seg<2?4:seg+3))&15); return a^mask; }
  const mask=n<0?0x7f:0xff; n=Math.min(32635,Math.abs(n))+132; let seg=0; for(let x=n>>8;x>0;x>>=1)seg++; return ((seg<<4)|((n>>(seg+3))&15))^mask;
}
export function parseRtp(b) {
  if(b.length<12||(b[0]>>6)!==2)return null;
  let offset=12+(b[0]&15)*4;
  if(offset>b.length)return null;
  if(b[0]&16){if(offset+4>b.length)return null;offset+=4+b.readUInt16BE(offset+2)*4;}
  const end=b.length-((b[0]&32)?b.at(-1):0);
  if(offset>=end)return null;
  return {payload:b.subarray(offset,end),pt:b[1]&127,marker:!!(b[1]&128),seq:b.readUInt16BE(2),timestamp:b.readUInt32BE(4),ssrc:b.readUInt32BE(8)};
}
export function makeRtp(payload,{pt=8,seq=0,timestamp=0,ssrc=1,marker=false}={}) {
  const h=Buffer.alloc(12);h[0]=128;h[1]=pt|(marker?128:0);h.writeUInt16BE(seq&65535,2);h.writeUInt32BE(timestamp>>>0,4);h.writeUInt32BE(ssrc>>>0,8);return Buffer.concat([h,payload]);
}
export function makeStunBinding(){const packet=Buffer.alloc(20);packet.writeUInt16BE(1,0);packet.writeUInt32BE(0x2112a442,4);randomBytes(12).copy(packet,8);return packet;}
export function stunBindingResponse(packet,request){return !!request&&packet.length>=20&&packet.readUInt16BE(0)===0x0101&&packet.readUInt32BE(4)===0x2112a442&&packet.readUInt16BE(2)%4===0&&packet.length===20+packet.readUInt16BE(2)&&packet.subarray(8,20).equals(request.subarray(8,20));}
export class H264Assembler {
  constructor(){this.timestamp=null;this.parts=[];this.fu=null;this.bytes=0;this.seq=null;this.bad=false;this.sps=null;this.pps=null;this.waitKey=true;}
  feed(p) {
    if(p.timestamp!==this.timestamp){this.timestamp=p.timestamp;this.parts=[];this.fu=null;this.bytes=0;this.bad=false;}
    if(this.seq!==null&&((this.seq+1)&65535)!==p.seq){this.bad=true;this.waitKey=true;}this.seq=p.seq;
    const b=p.payload;if(!b.length)return null;const type=b[0]&31;
    const add=n=>{this.parts.push(n);this.bytes+=n.length;if((n[0]&31)===7)this.sps=n;if((n[0]&31)===8)this.pps=n;};
    if(type>0&&type<24)add(b);
    else if(type===24){for(let i=1;i+2<=b.length;){const size=b.readUInt16BE(i);i+=2;if(!size||i+size>b.length){this.bad=true;break;}add(b.subarray(i,i+size));i+=size;}}
    else if(type===28&&b.length>=3){if(b[1]&128)this.fu=[Buffer.from([(b[0]&0xe0)|(b[1]&31)]),b.subarray(2)];else if(this.fu)this.fu.push(b.subarray(2));else this.bad=true;
      this.bytes+=b.length;if(b[1]&64&&this.fu){add(Buffer.concat(this.fu));this.fu=null;}}
    else this.bad=true;
    if(this.bytes>2*1024*1024){this.parts=[];this.fu=null;this.bad=true;}
    if(!p.marker)return null;
    const key=this.parts.some(n=>(n[0]&31)===5);
    if(this.bad||this.fu||!this.parts.length||(this.waitKey&&!key))return null;
    if(key)this.waitKey=false;
    const parts=key?[...(this.sps?[this.sps]:[]),...(this.pps?[this.pps]:[]),...this.parts]:this.parts;
    return {key,timestamp:p.timestamp,codec:this.sps&&this.sps.length>=4?'avc1.'+this.sps.subarray(1,4).toString('hex'):null,
      bytes:Buffer.concat(parts.flatMap(n=>[Buffer.from([0,0,0,1]),n]))};
  }
}
export function parseSdp(sdp) {
  const out=[];let item=null,ip='',direction='sendrecv';
  for(const line of sdp.split(/\r?\n/)){
    if(line.startsWith('m=')){const [,kind,port,protocol,pts]=line.match(/^m=(\w+) (\d+) (\S+) (.*)$/)||[];item={kind,port:Number(port),protocol,pts:(pts||'').split(' ').map(Number),ip,direction,codecs:{0:'PCMU',8:'PCMA'},fmtp:{}};out.push(item);}
    if(line.startsWith('c=')){const addr=line.split(' ')[2];if(item)item.ip=addr;else ip=addr;}
    const map=line.match(/^a=rtpmap:(\d+) ([\w-]+)\/(\d+)/);if(map&&item){item.codecs[map[1]]=map[2].toUpperCase();if(['PCMA','PCMU'].includes(map[2].toUpperCase())&&map[3]!=='8000')delete item.codecs[map[1]];}
    const fmtp=line.match(/^a=fmtp:(\d+) (.*)/);if(fmtp&&item)item.fmtp[fmtp[1]]=fmtp[2];
    if(/^a=(sendrecv|recvonly|sendonly|inactive)$/.test(line)){if(item)item.direction=line.slice(2);else direction=line.slice(2);}
    const rtcp=line.match(/^a=rtcp:(\d+)(?: IN IP4 (\S+))?/);if(rtcp&&item){item.rtcpPort=Number(rtcp[1]);item.rtcpIp=rtcp[2];}
    if(line==='a=rtcp-mux'&&item)item.rtcpMux=true;
  }return out;
}
const bind=async(port=0,ip='0.0.0.0')=>{const s=dgram.createSocket('udp4');s.on('error',()=>{});try{await new Promise((r,j)=>{s.once('error',j);s.bind(port,ip,()=>{s.removeListener('error',j);r();});});return s;}catch(e){s.close();throw e;}};
async function bindPair(ip){for(let attempt=0;attempt<32;attempt++){const rtp=await bind(0,ip);const port=rtp.address().port;if(port%2||port>=65535){rtp.close();continue;}try{return [rtp,await bind(port+1,ip)];}catch(e){rtp.close();if(e.code!=='EADDRINUSE')throw e;}}throw new Error('MEDIA_PORT_UNAVAILABLE');}
export function parseRtcp(bytes){const packets=[];for(let offset=0;offset<bytes.length;){if(offset+4>bytes.length||(bytes[offset]>>6)!==2||bytes[offset+1]<200||bytes[offset+1]>211)return null;const length=(bytes.readUInt16BE(offset+2)+1)*4;if(length<4||offset+length>bytes.length)return null;packets.push({type:bytes[offset+1],count:bytes[offset]&31,bytes:bytes.subarray(offset,offset+length)});offset+=length;}return packets.length?packets:null;}
export function makeRtcpReport({ssrc,cname='tyg-local',sender=null,receiver=null,pli=false,now=Date.now()}){
  const headerSize=sender?28:8,report=Buffer.alloc(headerSize+(receiver?24:0));report[0]=0x80+(receiver?1:0);report[1]=sender?200:201;report.writeUInt16BE(report.length/4-1,2);report.writeUInt32BE(ssrc>>>0,4);
  if(sender){report.writeUInt32BE((Math.floor(now/1000)+2208988800)>>>0,8);report.writeUInt32BE(Math.floor(now%1000*4294967296/1000)>>>0,12);report.writeUInt32BE(sender.timestamp>>>0,16);report.writeUInt32BE(sender.packets>>>0,20);report.writeUInt32BE(sender.octets>>>0,24);}
  if(receiver){const o=headerSize;report.writeUInt32BE(receiver.ssrc>>>0,o);report[o+4]=receiver.fractionLost||0;report.writeIntBE(Math.max(-8388608,Math.min(8388607,receiver.lost||0)),o+5,3);report.writeUInt32BE(receiver.highest>>>0,o+8);report.writeUInt32BE(Math.round(receiver.jitter||0)>>>0,o+12);report.writeUInt32BE(receiver.lsr>>>0,o+16);report.writeUInt32BE(receiver.dlsr>>>0,o+20);}
  const name=Buffer.from(cname).subarray(0,255),sdes=Buffer.alloc(Math.ceil((11+name.length)/4)*4);sdes[0]=0x81;sdes[1]=202;sdes.writeUInt16BE(sdes.length/4-1,2);sdes.writeUInt32BE(ssrc>>>0,4);sdes[8]=1;sdes[9]=name.length;name.copy(sdes,10);
  const parts=[report,sdes];if(pli&&receiver){const feedback=Buffer.alloc(12);feedback[0]=0x81;feedback[1]=206;feedback.writeUInt16BE(2,2);feedback.writeUInt32BE(ssrc>>>0,4);feedback.writeUInt32BE(receiver.ssrc>>>0,8);parts.push(feedback);}return Buffer.concat(parts);
}
export class RtpMedia {
  constructor(emit,options={}){this.emit=emit;this.options=options;this.ice={};this.sockets=[];this.seq=randomBytes(2).readUInt16BE();this.timestamp=randomBytes(4).readUInt32BE();this.ssrc=randomBytes(4).readUInt32BE();this.videoLocalSsrc=randomBytes(4).readUInt32BE();this.cname=randomBytes(12).toString('hex')+'@tyg-local';this.receivers={};this.stats={audioReceived:0,audioSent:0,videoReceived:0,videoFrames:0,dropped:0,mediaBindingSent:0,mediaBindingResponses:0,audioPacketsSeen:0,audioUnexpectedPayload:0,audioPayloadsSeen:[],sourcePortChanges:0,rtcpSent:0,rtcpReceived:0,keyFrameRequests:0,microphoneFrames:0,microphoneActiveFrames:0,firstAudioMs:null,firstVideoPacketMs:null,firstVideoFrameMs:null};this.audioOctets=0;}
  async init(ip,video){try{[this.audio,this.audioRtcp]=await bindPair(ip);this.sockets.push(this.audio,this.audioRtcp);if(video){[this.video,this.videoRtcp]=await bindPair(ip);this.sockets.push(this.video,this.videoRtcp);}
    let credentials;for(const kind of ['audio','video']){if(!this[kind])continue;for(const component of [1,2]){const key=kind+(component===2?'Rtcp':'');this.ice[key]=new IceTransport({socket:this[key],ip,credentials,component,options:this.options.ice||{},onData:(b,r)=>component===1?this.receive(b,r,kind==='video'):this.receiveControl(b,r,kind),onState:()=>{if(this.negotiated&&this.description){this.description.ice=this.iceSnapshot();this.emit('control-state',this.description);}}});credentials=this.ice[key].credentials;}}
    await Promise.all(Object.values(this.ice).map(transport=>transport.gather()));if(this.closed)throw new Error('MEDIA_CLOSED');
    this.audio.on('message',(b,r)=>{if(!this.ice.audio.enabled)this.receive(b,r,false);});this.video?.on('message',(b,r)=>{if(!this.ice.video.enabled)this.receive(b,r,true);});this.audioRtcp.on('message',(b,r)=>{if(!this.ice.audioRtcp.enabled)this.receiveControl(b,r,'audio');});this.videoRtcp?.on('message',(b,r)=>{if(!this.ice.videoRtcp.enabled)this.receiveControl(b,r,'video');});
    const iceLines=kind=>this.options.offerIce?[...this.ice[kind].sdpLines().filter(line=>line!=='a=end-of-candidates'),...this.ice[kind+'Rtcp'].sdpLines().filter(line=>line.startsWith('a=candidate:')),'a=end-of-candidates']:[];
    const sid=Date.now();return ['v=0',`o=- ${sid} ${sid} IN IP4 ${ip}`,'s=horimedia',`c=IN IP4 ${ip}`,'t=0 0',`m=audio ${this.audio.address().port} RTP/AVP 8 0`,`a=rtcp:${this.audioRtcp.address().port} IN IP4 ${ip}`,'a=rtcp-mux',...iceLines('audio'),'a=rtpmap:8 PCMA/8000','a=rtpmap:0 PCMU/8000',this.options.mode==='monitor'?'a=inactive':'a=sendrecv','a=ptime:20',...(video?[`m=video ${this.video.address().port} RTP/AVP 99`,`a=rtcp:${this.videoRtcp.address().port} IN IP4 ${ip}`,'a=rtcp-mux',...iceLines('video'),'a=rtpmap:99 H264/90000','a=fmtp:99 packetization-mode=1;profile-level-id=42E01E','a=rtcp-fb:99 nack pli',this.options.apkBridge?'a=sendrecv':'a=recvonly']:[])].join('\r\n')+'\r\n';
    }catch(e){this.close();throw e;}}
  async negotiate(sdp){
    if(this.negotiated&&sdp===this.lastSdp)return this.description;
    // Reject invalid renegotiation before modifying the established media path.
    const check=parseSdp(sdp),checkAudio=check.find(s=>s.kind==='audio');
    if(!checkAudio||!checkAudio.port||checkAudio.port>65535||isIP(checkAudio.ip)!==4||!['RTP/AVP','RTP/AVPF'].includes(checkAudio.protocol)||!checkAudio.pts.some(p=>['PCMA','PCMU'].includes(checkAudio.codecs[p])))throw new Error('MEDIA_UNSUPPORTED');
    for(const section of check){if(section.rtcpPort&&(!Number.isInteger(section.rtcpPort)||section.rtcpPort>65535)||section.rtcpIp&&isIP(section.rtcpIp)!==4)throw new Error('MEDIA_UNSUPPORTED');}
    for(const section of parseIce(sdp)){if(!section.usernameFragment&&!section.password)continue;if(!/^[A-Za-z0-9+/]{4,256}$/.test(section.usernameFragment||'')||! /^[A-Za-z0-9+/]{22,256}$/.test(section.password||'')||!section.candidates.some(c=>c.component===1))throw new Error('MEDIA_ICE_INVALID');}
    if(this.negotiated){this.stopTimers();this.receivers={};this.audioPeer=null;this.videoPeer=null;this.videoSsrc=null;this.audioControlPeer=null;this.videoControlPeer=null;this.remoteVideo=null;}
    const sections=parseSdp(sdp); const audio=sections.find(s=>s.kind==='audio');
    if(!audio||!audio.port||!['RTP/AVP','RTP/AVPF'].includes(audio.protocol)||isIP(audio.ip)!==4||audio.port>65535)throw new Error('MEDIA_UNSUPPORTED');
    audio.pt=audio.pts.find(p=>['PCMA','PCMU'].includes(audio.codecs[p]));if(audio.pt==null)throw new Error('MEDIA_UNSUPPORTED');
    if(this.options.mode==='monitor')audio.direction='inactive';this.remoteAudio=audio; const video=sections.find(s=>s.kind==='video'&&s.port);
    if(video&&this.video){video.pt=video.pts.find(p=>video.codecs[p]==='H264');if(['RTP/AVP','RTP/AVPF'].includes(video.protocol)&&isIP(video.ip)===4&&video.port<=65535&&video.pt!=null&&!/packetization-mode=2/.test(video.fmtp[video.pt]||'')){this.remoteVideo=video;this.h264=new H264Assembler();
      const params=video.fmtp[video.pt]?.match(/sprop-parameter-sets=([^;]+)/)?.[1]?.split(',').map(v=>Buffer.from(v,'base64'));if(params){this.h264.sps=params[0];this.h264.pps=params[1];}}}
    // Keep sockets unconnected: media relays may send from a different source
    // port. Validate the negotiated IP, payload and pinned SSRC before accepting.
    for(const remote of [audio,this.remoteVideo].filter(Boolean)){if(remote.rtcpPort&&(!Number.isInteger(remote.rtcpPort)||remote.rtcpPort>65535)||remote.rtcpIp&&isIP(remote.rtcpIp)!==4)throw new Error('MEDIA_UNSUPPORTED');}
    // APK WebRTC bridge reconstructs its own answer with RTCPMuxPolicy.REQUIRE;
    // the native SIP SDP omits this attribute. Apply only to that bridge mode.
    if(this.options.apkBridge){audio.rtcpMux=true;if(this.remoteVideo)this.remoteVideo.rtcpMux=true;}
    this.startedAt??=Date.now();this.negotiated=true;this.lastSdp=sdp;
    const iceSections=parseIce(sdp);for(const kind of ['audio','video']){const remote=kind==='audio'?this.remoteAudio:this.remoteVideo;const ice=remote&&remote.direction!=='inactive'?iceSections.find(section=>section.kind===kind):null;await this.ice[kind]?.start(ice);await this.ice[kind+'Rtcp']?.start(remote&&!remote.rtcpMux?ice:null);}
    // A UDP connect alone sends nothing and cannot create a video NAT mapping.
    // Probe only the negotiated media endpoints; no third-party STUN/TURN server.
    this.primeMedia();if(this.options.apkBridge){let attempts=0;this.startupProbes=setInterval(()=>{if(++attempts>12){clearInterval(this.startupProbes);return;}this.primeMedia();},250);this.startupProbes.unref();}this.bindingKeepalive=setInterval(()=>this.primeMedia(),5000);this.bindingKeepalive.unref();
    this.sendReports();this.reports=setInterval(()=>this.sendReports(),5000);this.reports.unref();
    this.tone=setInterval(()=>{const pcm=this.queue?.shift()||Buffer.alloc(320);this.sendPcm(pcm);},20);this.tone.unref();
    this.feedback=setInterval(()=>{if(this.h264?.waitKey)this.requestKeyFrame();},1000);this.feedback.unref();
    this.description={mode:this.options.mode||'talk',bridgeMode:this.options.apkBridge?'apk':'standard',audioCodec:audio.codecs[audio.pt],audioDirection:audio.direction,videoCodec:this.remoteVideo?'H264':null,videoDirection:this.remoteVideo?.direction||'inactive',audioRtcpMux:!!audio.rtcpMux,videoRtcpMux:!!this.remoteVideo?.rtcpMux,ice:this.iceSnapshot()};return this.description;
  }
  iceSnapshot(){return Object.fromEntries(Object.entries(this.ice).map(([key,value])=>[key,value.snapshot()]));}
  answer(sdp){const lines=['v=0',`o=- ${Date.now()} 1 IN IP4 ${this.audio.address().address}`,'s=horimedia',`c=IN IP4 ${this.audio.address().address}`,'t=0 0'];const iceSections=parseIce(sdp);for(const section of parseSdp(sdp)){const kind=section.kind,socket=this[kind],pt=section.pts.find(p=>kind==='audio'?['PCMA','PCMU'].includes(section.codecs[p]):section.codecs[p]==='H264');if(!socket||pt==null){lines.push(`m=${kind} 0 ${section.protocol} ${section.pts[0]||0}`);continue;}lines.push(`m=${kind} ${socket.address().port} ${section.protocol} ${pt}`,`a=rtpmap:${pt} ${section.codecs[pt]}/${kind==='audio'?8000:90000}`);if(section.rtcpMux)lines.push('a=rtcp-mux');else lines.push(`a=rtcp:${this[kind+'Rtcp'].address().port} IN IP4 ${socket.address().address}`);if(iceSections.find(s=>s.kind===kind)?.usernameFragment)lines.push(...this.ice[kind].sdpLines().filter(s=>s!=='a=end-of-candidates'),...(!section.rtcpMux?this.ice[kind+'Rtcp'].sdpLines().filter(s=>s.startsWith('a=candidate:')):[]),'a=end-of-candidates');lines.push('a='+(kind==='audio'&&this.options.mode==='monitor'?'inactive':({sendonly:'recvonly',recvonly:'sendonly',inactive:'inactive',sendrecv:'sendrecv'}[section.direction]||'sendrecv')));if(kind==='audio')lines.push('a=ptime:20');else lines.push(`a=fmtp:${pt} packetization-mode=1;profile-level-id=42E01E`,`a=rtcp-fb:${pt} nack pli`);}return lines.join('\r\n')+'\r\n';}
  stopTimers(){clearInterval(this.tone);clearInterval(this.feedback);clearInterval(this.bindingKeepalive);clearInterval(this.reports);clearInterval(this.startupProbes);}
  enqueue(pcm){if(this.options.mode==='monitor')return;if(!Buffer.isBuffer(pcm)||pcm.length!==320)return;this.stats.microphoneFrames++;let power=0;for(let i=0;i<160;i++)power+=pcm.readInt16LE(i*2)**2;if(Math.sqrt(power/160)>100)this.stats.microphoneActiveFrames++;this.queue??=[];if(this.queue.length>10)this.queue.shift();this.queue.push(pcm);}
  primeMedia(){for(const kind of ['audio','video']){const socket=this[kind],remote=kind==='video'?this.remoteVideo:this.remoteAudio;if(!socket||!remote||remote.direction==='inactive')continue;
    if(this.ice[kind]?.enabled)continue;const request=makeStunBinding();this[kind+'Binding']=request;socket.send(request,remote.port,remote.ip,()=>{});this.stats.mediaBindingSent++;}}
  sendPcm(pcm){const a=this.remoteAudio;if(!a||['sendonly','inactive'].includes(a.direction))return;const transport=this.ice.audio;if(transport?.enabled&&!transport.peer())return;const p=Buffer.alloc(pcm.length/2);for(let i=0;i<p.length;i++)p[i]=encodeG711(pcm.readInt16LE(i*2),a.codecs[a.pt]);const packet=makeRtp(p,{pt:a.pt,seq:this.seq++,timestamp:this.timestamp,ssrc:this.ssrc,marker:this.stats.audioSent===0});if(!transport?.send(packet))this.audio.send(packet,this.audioPeer?.port||a.port,a.ip,()=>{});this.timestamp=(this.timestamp+p.length)>>>0;this.stats.audioSent++;this.audioOctets+=p.length;}
  receive(b,r,video){const remote=video?this.remoteVideo:this.remoteAudio;if(!remote)return;
    const transport=this.ice[video?'video':'audio'],selected=transport?.enabled?transport.peer():null;if(transport?.enabled?(!selected||r.address!==selected.address||r.port!==selected.port):r.address!==remote.ip)return;
    if(isStun(b)){if(stunBindingResponse(b,this[(video?'video':'audio')+'Binding']))this.stats.mediaBindingResponses++;else if(!transport?.enabled){const reply=bindingResponse(b,r);if(reply)this[video?'video':'audio'].send(reply,r.port,r.address,()=>{});}return;}
    if(stunBindingResponse(b,this[(video?'video':'audio')+'Binding'])){this.stats.mediaBindingResponses++;return;}
    if(remote.rtcpMux&&parseRtcp(b)){this.receiveControl(b,r,video?'video':'audio');return;}
    const p=parseRtp(b);if(!p)return;
    if(!video){this.stats.audioPacketsSeen++;if(!this.stats.audioPayloadsSeen.includes(p.pt)&&this.stats.audioPayloadsSeen.length<16)this.stats.audioPayloadsSeen.push(p.pt);}
    if(!remote.pts.includes(p.pt)||(video?p.pt!==remote.pt:!['PCMA','PCMU'].includes(remote.codecs[p.pt]))){if(!video)this.stats.audioUnexpectedPayload++;return;}
    const kind=video?'video':'audio';if(this.receivers[kind]&&this.receivers[kind].ssrc!==p.ssrc)return;
    if(r.port!==remote.port&&!this[kind+'Peer'])this.stats.sourcePortChanges++;this[kind+'Peer']={port:r.port};this.track(kind,p,video?90000:8000);
    if(video){this.stats.videoReceived++;this.stats.firstVideoPacketMs??=Date.now()-this.startedAt;const first=this.videoSsrc==null;this.videoSsrc=p.ssrc;if(first)this.requestKeyFrame();const f=this.h264.feed(p);if(f){this.stats.firstVideoFrameMs??=Date.now()-this.startedAt;this.stats.videoFrames++;this.emit('video',f);}else if(p.marker)this.stats.dropped++;}
    else{if(['recvonly','inactive'].includes(remote.direction))return;this.stats.audioReceived++;this.stats.firstAudioMs??=Date.now()-this.startedAt;const pcm=Buffer.alloc(p.payload.length*2);for(let i=0;i<p.payload.length;i++)pcm.writeInt16LE(decodeG711(p.payload[i],remote.codecs[p.pt]),i*2);this.emit('audio',pcm);}}
  track(kind,p,clock){let state=this.receivers[kind];if(!state)this.receivers[kind]=state={ssrc:p.ssrc,base:p.seq,highest:p.seq,received:0,jitter:0,previousExpected:0,previousReceived:0};let extended=(state.highest&0xffff0000)+p.seq;if(extended<state.highest-32768)extended+=65536;else if(extended>state.highest+32768)extended-=65536;state.highest=Math.max(state.highest,extended);state.received++;const transit=Date.now()*clock/1000-p.timestamp;if(state.transit!=null)state.jitter+=(Math.abs(transit-state.transit)-state.jitter)/16;state.transit=transit;}
  receiverReport(kind){const state=this.receivers[kind];if(!state)return null;const expected=state.highest-state.base+1,lost=expected-state.received,interval=expected-state.previousExpected,intervalLost=interval-(state.received-state.previousReceived);state.previousExpected=expected;state.previousReceived=state.received;return {...state,lost,fractionLost:interval>0&&intervalLost>0?Math.min(255,Math.floor(intervalLost*256/interval)):0,lsr:state.lsr||0,dlsr:state.lastSrAt?Math.min(4294967295,Math.floor((Date.now()-state.lastSrAt)*65.536)):0};}
  receiveControl(bytes,peer,kind){const remote=kind==='video'?this.remoteVideo:this.remoteAudio,transport=this.ice[kind+(remote?.rtcpMux?'':'Rtcp')],selected=transport?.enabled?transport.peer():null;if(!remote||(transport?.enabled?(!selected||peer.address!==selected.address||peer.port!==selected.port):![remote.ip,remote.rtcpIp].includes(peer.address)))return;const packets=parseRtcp(bytes);if(!packets)return;this.stats.rtcpReceived++;this[kind+'ControlPeer']={port:peer.port,address:peer.address};for(const p of packets){if(p.type===200&&p.bytes.length>=28){const state=this.receivers[kind];if(state&&state.ssrc===p.bytes.readUInt32BE(4)){state.lsr=(((p.bytes.readUInt32BE(8)&65535)<<16)|(p.bytes.readUInt32BE(12)>>>16))>>>0;state.lastSrAt=Date.now();}}}}
  sendReport(kind,pli=false){const remote=kind==='video'?this.remoteVideo:this.remoteAudio;if(!remote||remote.direction==='inactive')return;const receiver=this.receiverReport(kind);if(pli&&!receiver)return;const controlPeer=this[kind+'ControlPeer'];const socket=remote.rtcpMux?this[kind]:this[kind+'Rtcp'];const port=controlPeer?.port||(remote.rtcpMux?(this[kind+'Peer']?.port||remote.port):(remote.rtcpPort||remote.port+1)),ip=controlPeer?.address||remote.rtcpIp||remote.ip;if(!socket||port>65535)return;
    const packet=makeRtcpReport({ssrc:kind==='video'?this.videoLocalSsrc:this.ssrc,cname:this.cname,receiver,pli,sender:kind==='audio'&&this.stats.audioSent?{timestamp:this.timestamp,packets:this.stats.audioSent,octets:this.audioOctets}:null});const transport=this.ice[kind+(remote.rtcpMux?'':'Rtcp')];if(transport?.enabled&&!transport.peer())return;if(!transport?.send(packet))socket.send(packet,port,ip,()=>{});this.stats.rtcpSent++;if(pli)this.stats.keyFrameRequests++;}
  sendReports(){this.sendReport('audio');this.sendReport('video');}
  requestKeyFrame(){if(this.videoSsrc!=null)this.sendReport('video',true);}
  close(){this.closed=true;this.stopTimers();for(const value of Object.values(this.ice))value.close().catch(()=>{});for(const s of this.sockets){try{s.close();}catch{}}this.sockets=[];this.queue=[];this.audioBinding=null;this.videoBinding=null;this.negotiated=false;}
}
