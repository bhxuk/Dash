/* Pure browser/Node parser: imported shortcuts are data, never executed. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DashImport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function entities(s){return String(s).replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,(m,n,k)=>{if(n){const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):m;}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[k.toLowerCase()];});}
 function decode(bytes){bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';return new TextDecoder(encoding).decode(bytes);}
 function canonical(value){const u=new URL(String(value).trim());if(!['http:','https:'].includes(u.protocol)||u.username||u.password||/[\x00-\x20]/.test(value))throw new Error('Only complete HTTP/HTTPS website URLs without credentials are supported.');return u.href;}
 function cells(line,delimiter){const out=[];let current='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){current+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){out.push(current.trim());current='';}else current+=c;}if(quoted)throw new Error('Unclosed quote in delimited row.');out.push(current.trim());return out;}
 function parse(text,filename='pasted links'){
  text=String(text).replace(/^\uFEFF/,'');const result=[];
  const add=(name,url,category='',description='')=>result.push({name:String(name||'').trim(),url:String(url||'').trim(),category:String(category||'').trim(),description:String(description||'').trim(),source:filename});
  if(/\.lnk$/i.test(filename))return [{name:filename,url:'',error:'Windows .lnk files launch programs and cannot be imported as web links. Use Internet Shortcut (.url) files instead.',source:filename}];
  if(/\[InternetShortcut\]/i.test(text)||/\.url$/i.test(filename)){
   const url=text.match(/^\s*URL\s*=\s*(.+)$/im);add(filename.replace(/\.url$/i,''),url?.[1]||'');return result;
  }
  if(/\.webloc$/i.test(filename)||/<key>\s*URL\s*<\/key>/i.test(text)){
   const m=text.match(/<key>\s*URL\s*<\/key>\s*<string>([\s\S]*?)<\/string>/i);add(filename.replace(/\.webloc$/i,''),entities(m?.[1]||''));return result;
  }
  if(/<a\b[^>]*href\s*=/i.test(text)){
   for(const m of text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))add(entities(m[2].replace(/<[^>]*>/g,'')),entities(m[1]));
   return result;
  }
  let header=null;
  for(const original of text.split(/\r?\n/)){
   let line=original.trim();if(!line||/^\s*(#|;|\/\/)/.test(line))continue;
   line=line.replace(/^[-*•]\s+|^\d+[.)]\s+/,'');
   const md=line.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?:\s*(?:\||-)\s*(.*))?$/i);
   if(md){add(md[1],md[2],md[3]);continue;}
   let delimiter=line.includes('\t')?'\t':line.includes('|')?'|':line.includes(',')?',':null;
   // A bare URL can contain commas or pipes in its query string.
   if(!header&&!/\.(csv|tsv)$/i.test(filename)&&/^https?:\/\/\S+$/i.test(line)&&!line.includes(' | ')){add('',line);continue;}
   try{
    let row=delimiter?cells(line,delimiter):[line];if(delimiter==='|'){if(row[0]==='')row.shift();if(row.at(-1)==='')row.pop();}
    if(row.every(c=>/^:?-+:?$/.test(c)))continue;
    const lower=row.map(c=>c.toLowerCase());
    if(lower.some(c=>['url','link','address','website'].includes(c))){header=lower;continue;}
    if(header&&row.length>1){const get=(names)=>row[header.findIndex(c=>names.includes(c))]||'';add(get(['name','title']),get(['url','link','address','website']),get(['category','folder','group']),get(['description','notes']));continue;}
    const index=row.findIndex(c=>/^https?:\/\//i.test(c));
    if(index>=0){const url=row[index];if(index===0)add(row[1]||'',url,row[2]||'',row[3]||'');else add(row[0],url,row[index+1]||'',row[index+2]||'');}
    else {const match=line.match(/^(.*?)\s+(https?:\/\/\S+)$/i);if(match)add(match[1].replace(/\s*[-:]\s*$/,''),match[2]);else add('',line);}
   }catch(e){result.push({name:line.slice(0,80),url:'',error:e.message,source:filename});}
  }
  return result;
 }
 function review(rows,existing=[]){const seen=new Set(existing.map(x=>{try{return canonical(x.url);}catch{return x.url;}}));return rows.map(row=>{const item={...row,selected:false};try{if(item.error)throw new Error(item.error);item.url=canonical(item.url);item.name=item.name||new URL(item.url).hostname;if(item.name.length>80||item.category.length>40||item.description.length>500||item.url.length>2048)throw new Error('Name, category, description or URL exceeds the supported length.');if(seen.has(item.url)){item.status='duplicate';item.error='Already saved or repeated in this import.';}else{item.status='ready';item.selected=true;seen.add(item.url);}}catch(e){item.status='invalid';item.error=e.message;}return item;});}
 return {parse,review,canonical,decode};
});
