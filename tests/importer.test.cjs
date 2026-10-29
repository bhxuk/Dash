const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parse,review,canonical,decode}=require('../app/static/importer.js');

test('pasted URLs, named lists, Markdown and category columns',()=>{
 const rows=review(parse('https://example.com\nPlex | http://server.local:32400/web | Media\n- [My tools](https://tools.example.com) | Tools\n# comment'));
 assert.equal(rows.length,3);assert.ok(rows.every(r=>r.status==='ready'));
 assert.equal(rows[0].name,'example.com');assert.equal(rows[1].category,'Media');assert.equal(rows[2].name,'My tools');
});
test('CSV headers, escaped quotes, URL-first CSV and tabs',()=>{
 const rows=review(parse('Name,URL,Category,Description\n"A, B",https://example.com,Work,"say ""hello"""','links.csv'));
 assert.equal(rows[0].name,'A, B');assert.equal(rows[0].description,'say "hello"');
 const urlFirst=review(parse('URL,Name,Category\nhttps://example.com,Example,Work','links.csv'));
 assert.equal(urlFirst[0].name,'Example');assert.equal(urlFirst[0].category,'Work');
 const tsv=review(parse('Name\tURL\tCategory\nLocal app\thttp://server.local:8080\tHomelab','list.tsv'));
 assert.equal(tsv[0].category,'Homelab');
});
test('Windows and Mac Internet shortcuts and HTML bookmarks',()=>{
 assert.equal(review(parse('[InternetShortcut]\r\nURL=https://example.com/path?a=1&b=2','Example.url'))[0].name,'Example');
 const mac=review(parse('<plist><dict><key>URL</key><string>https://example.com/?a=1&amp;b=2</string></dict></plist>','Mac.webloc'));
 assert.equal(mac[0].url,'https://example.com/?a=1&b=2');
 const bookmarks=review(parse('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://example.com">Example &amp; Tools</A></DL>','bookmarks.html'));
 assert.equal(bookmarks[0].name,'Example & Tools');
});
test('duplicates are skipped against existing links and within a batch',()=>{
 const rows=review(parse('Existing | https://example.com\nNew | https://new.example.com\nRepeat | https://new.example.com/'),[{url:'https://example.com/'}]);
 assert.deepEqual(rows.map(r=>r.status),['duplicate','ready','duplicate']);
 assert.deepEqual(rows.map(r=>r.selected),[false,true,false]);
});
test('invalid URLs, credentials, desktop shortcuts and long fields stay unselected',()=>{
 const rows=review(parse('javascript:alert(1)\nfile:///etc/passwd\nhttps://user:pass@example.com\njust some text'));
 assert.ok(rows.every(r=>r.status==='invalid'&&!r.selected));
 assert.match(review(parse('','Program.lnk'))[0].error,/Internet Shortcut/);
 assert.equal(review(parse('x'.repeat(81)+' | https://example.com'))[0].status,'invalid');
 assert.throws(()=>canonical('data:text/html,bad'));
});
test('CSV errors and Markdown table dividers are handled without losing valid rows',()=>{
 const rows=review(parse('Name | URL | Category\n--- | --- | ---\nExample | https://example.com | Work\n"unclosed,https://bad.example.com','links.csv'));
 assert.equal(rows[0].status,'ready');assert.equal(rows[1].status,'invalid');
});

test('UTF-16 Windows file bytes follow the same decoding path as browser file imports',()=>{
 const input='[InternetShortcut]\r\nURL=https://radio.example.com\r\n';
 const bytes=Buffer.concat([Buffer.from([255,254]),Buffer.from(input,'utf16le')]);
 const rows=review(parse(decode(bytes),'Radio.url'));
 assert.equal(rows[0].status,'ready');assert.equal(rows[0].url,'https://radio.example.com/');
 assert.equal(decode(new TextEncoder().encode('hello')),'hello');
});
