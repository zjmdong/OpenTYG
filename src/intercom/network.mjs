import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {networkInterfaces} from 'node:os';
export const isFakeIp=address=>/^198\.(18|19)\./.test(address);
// Fake-IP is a proxy lookup key, not a usable SIP Via/SDP address.
export async function resolveSip(host,{lookupFn=lookup,fetchFn=fetch}={}){
 const answers=await lookupFn(host,{family:4,all:true});
 if(!answers.some(a=>isFakeIp(a.address)))return {answers,resolution:'system'};
 for(const base of ['https://dns.alidns.com/resolve','https://dns.google/resolve']){try{
  const response=await fetchFn(base+'?name='+encodeURIComponent(host)+'&type=A',{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(2500)});
  if(!response.ok)continue;const result=await response.json();
  const real=[...new Set((result.Answer||[]).filter(a=>a.type===1&&isIP(a.data)===4&&!isFakeIp(a.data)).map(a=>a.data))];
  if(real.length)return {answers:real.map(address=>({address,family:4})),resolution:'fake-ip-doh'};
 }catch{}}
 throw Object.assign(new Error('SIP_DNS_FAKE_IP'),{code:'SIP_DNS_FAKE_IP'});
}
export function physicalAddress(interfaces=networkInterfaces()){
 const candidates=Object.entries(interfaces).flatMap(([name,list])=>list.filter(a=>a.family==='IPv4'&&!a.internal&&!isFakeIp(a.address)&&!/^169\.254\./.test(a.address)&&a.mac!=='00:00:00:00:00:00'&&!/tailscale|vpn|tun|tap|virtual|wsl|docker/i.test(name)));
 return candidates[0]?.address||null;
}
