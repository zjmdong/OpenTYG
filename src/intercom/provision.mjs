import { createHash, randomUUID } from 'node:crypto';

export const lowerMd5 = value => createHash('md5').update(String(value), 'utf8').digest('hex');
export const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const unescapeXML = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, c) => c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : Number(c.slice(1))) : ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[c]));
export function xmlFields(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML_INVALID');
  const fields = {};
  for (const m of xml.matchAll(/<([\w]+)\b[^>]*>([^<]*)<\/\1\s*>/g)) fields[m[1]] = unescapeXML(m[2].trim());
  return fields;
}
/** APK DownloadConfigProcess PHONE_BOOK/ENTRY -> doornum.number = Code. */
export function parseConfiguration(xml) {
  const f = xmlFields(xml), devices = [];
  const book = xml.match(/<PHONE_BOOK\b[^>]*>([\s\S]*?)<\/PHONE_BOOK>/i)?.[1] || '';
  for (const m of book.matchAll(/<ENTRY\b([^>]*)(?:\/>|>)/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/([\w]+)\s*=\s*(["'])(.*?)\2/g)].map(v => [v[1], unescapeXML(v[3])]));
    // 原 APP 跳过住户分机和管理机；保留门口机类型。
    if (!['2','3','4','5','6','9'].includes(a.Type) || !a.Code) continue;
    if (!/^[+\w.-]{1,128}$/.test(a.Code)) throw new Error('SIP_NUMBER_INVALID');
    if (devices.some(d => d.number === a.Code)) continue;
    devices.push({ id: `intercom-${devices.length + 1}`, number:a.Code, name:a.Name || a.LocationName || a.Code,
      areaSerial:a.AreaSerial || '', areaName:a.AreaName || '', type:a.Type, status:a.status || '', monitorStatus:a.monitorStatus || '' });
  }
  for (const k of ['SIP_ACCOUNT','SIP_PASSWORD','SIP_DOMAIN','SIP_PROXY']) if (!f[k]) throw new Error('SIP_CONFIG_MISSING');
  for (const k of ['SIP_ACCOUNT','SIP_DOMAIN','SIP_PROXY']) if (/[\r\n<>"\s]/.test(f[k])) throw new Error('SIP_CONFIG_INVALID');
  if (!/^[+\w.-]{1,128}$/.test(f.SIP_ACCOUNT) || !/^[\w.-]+$/.test(f.SIP_PROXY) || !/^[\w.-]+(?::\d+)?$/.test(f.SIP_DOMAIN)) throw new Error('SIP_CONFIG_INVALID');
  const port = Number(f.SIP_PROXY_PORT || 6000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SIP_CONFIG_INVALID');
  return { id:randomUUID(), version:f.VERSION || '0', devices,
    sip:{account:f.SIP_ACCOUNT,password:f.SIP_PASSWORD,domain:f.SIP_DOMAIN,proxy:f.SIP_PROXY,port,backupPort:Number(f.SIP_BACKUP_PORT || 6001)} };
}
export async function provision({url, account, password, fetchImpl=fetch, timeoutMs=15000, signal}) {
  const cookies = new Map();
  const post = async (msgType, fields={}) => {
    const body = '<message>' + Object.entries({...fields,msgType}).map(([k,v]) => `<${k}>${escapeXML(v)}</${k}>`).join('') + '</message>';
    const r = await fetchImpl(url, {method:'POST', redirect:'error', headers:{'Content-Type':'application/x-www-form-urlencoded',
      ...(cookies.size ? {Cookie:[...cookies].map(([k,v]) => `${k}=${v}`).join('; ')} : {})}, body,
      signal:AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])])});
    if (!r.ok) throw new Error('INTERCOM_HTTP_STATUS');
    for (const cookie of r.headers.getSetCookie?.() || []) { const [kv] = cookie.split(';'), i=kv.indexOf('='); if (i>0) cookies.set(kv.slice(0,i),kv.slice(i+1)); }
    const reader = r.body.getReader(); let size=0; const chunks=[];
    while (true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>2*1024*1024){await reader.cancel();throw new Error('XML_INVALID');}chunks.push(Buffer.from(value)); }
    const xml = Buffer.concat(chunks).toString('utf8'), f=xmlFields(xml);
    if (f.faultCode != null && f.faultCode !== '0') throw new Error('INTERCOM_AUTH_REJECTED');
    // 原 APP 按字段解析，服务的实际响应名不等于 Java Rsp 类名。
    if (f.msgType && ![msgType+'Rsp',msgType+'Response',msgType,msgType.replace(/Request$/,'')+'Response'].includes(f.msgType)) throw new Error('XML_INVALID');
    return {xml,f};
  };
  const {f:seed}=await post('AuthcodeRequest');
  if (!seed.safeCode) throw new Error('XML_INVALID');
  const {f:auth}=await post('AuthenticationRequest',{userName:account,password:lowerMd5(lowerMd5(password)+':'+seed.safeCode)});
  if(auth.faultCode!=='0')throw new Error('INTERCOM_AUTH_REJECTED');
  await post('ConfigInformRequest',{configVersion:'0',dedicatedNumber:account,serialNumber:account});
  const {xml}=await post('MobileDownloadConfigRequest',{dedicatedNumber:account});
  const config=parseConfiguration(xml);
  await post('ConfigUpdateNotifyRequest',{downloadStatus:'1',configVersion:config.version});
  return config;
}
