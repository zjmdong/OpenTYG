import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const unavailable=()=>Object.assign(new Error('当前电脑无法使用登录凭据加密存储'),{code:'CREDENTIAL_STORE_UNAVAILABLE'});
// Secret bytes travel through stdin, never command arguments or log messages.
async function dpapi(bytes,protect){
  if(process.platform!=='win32')throw unavailable();
  const script='Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $e=[Text.Encoding]::UTF8.GetBytes("TYG-login-v1"); $s=[Security.Cryptography.DataProtectionScope]::CurrentUser; $r=[Security.Cryptography.ProtectedData]::'+(protect?'Protect':'Unprotect')+'($b,$e,$s); [Console]::Out.Write([Convert]::ToBase64String($r))';
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',failed=false;
    const timer=setTimeout(()=>{failed=true;child.kill();reject(unavailable());},10000);timer.unref();
    child.stdout.on('data',b=>{output+=b;if(output.length>131072){failed=true;child.kill();}});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
    child.once('error',()=>{clearTimeout(timer);reject(unavailable());});child.once('close',code=>{clearTimeout(timer);if(failed||code!==0||! /^[A-Za-z0-9+/=]+$/.test(output))reject(unavailable());else resolve(Buffer.from(output,'base64'));});child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}
export class WindowsLoginStore {
  constructor({origin,mode='official',directory}={}){
    this.directory=directory||join(process.env.LOCALAPPDATA||process.env.USERPROFILE||'.','TaoyuanguPrototype','saved-login');
    this.path=join(this.directory,createHash('sha256').update(mode+'\0'+origin).digest('hex').slice(0,32)+'.dpapi');
  }
  async status(){try{const info=await stat(this.path);return {saved:info.isFile(),storage:'Windows DPAPI'};}catch(e){if(e.code==='ENOENT')return {saved:false,storage:'Windows DPAPI'};throw unavailable();}}
  async save(bytes){const encrypted=await dpapi(bytes,true);await mkdir(this.directory,{recursive:true});const temporary=this.path+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,JSON.stringify({format:1,provider:'Windows DPAPI',ciphertext:encrypted.toString('base64')}),{mode:0o600});await rename(temporary,this.path);}finally{await unlink(temporary).catch(()=>{});}return this.status();}
  async load(){let encoded;try{encoded=await readFile(this.path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw unavailable();}try{if(encoded.length>131072)throw new Error();const envelope=JSON.parse(encoded);if(envelope.format!==1||envelope.provider!=='Windows DPAPI'||typeof envelope.ciphertext!=='string')throw new Error();return await dpapi(Buffer.from(envelope.ciphertext,'base64'),false);}catch{throw unavailable();}}
  async clear(){try{await unlink(this.path);}catch(e){if(e.code!=='ENOENT')throw unavailable();}return {saved:false,storage:'Windows DPAPI'};}
}
