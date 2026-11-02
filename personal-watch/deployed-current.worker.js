// personal-watch: watch.q08.org, a hand-picked, algorithm-free video queue for the owner (personal plane).
// WATCH-1 (2026-10-29, pillar personal): curated entertainment from readable source lists, with explicit device-local feedback.
// Likes, recent watches, and blocked channels stay in the browser; the worker keeps no per-user state.
var VERSION = "1.1.0";

var YT = [
  // [channel id, name, mood]. Moods: wonder (science/ideas), craft (making/engineering), weird (odd/dark/old), funny, calm.
  ["UCsXVk37bltHxD1rDPwtNM8Q", "Kurzgesagt", "wonder"], ["UCHnyfMqiRRG1u-2MsSQLbXA", "Veritasium", "wonder"],
  ["UC6nSFpj9HTCZ5t-N3Rm3-HA", "Vsauce", "wonder"], ["UC2C_jShtL725hvbm1arSV9w", "CGP Grey", "wonder"],
  ["UCoxcjq-8xIDTYp3uz647V5A", "Numberphile", "wonder"], ["UCYO_jab_esuFRV4b17AJtAw", "3Blue1Brown", "wonder"],
  ["UC9RM-iSvTu1uPJb8X5yp3EQ", "Wendover Productions", "wonder"], ["UCBa659QWEk1AI4Tg--mrJ2A", "Tom Scott", "wonder"],
  ["UCR1IuLEqb6UEA_zQ81kwXfg", "Real Engineering", "wonder"], ["UCJkMlOu7faDgqh4PfzbpLdg", "Nerdwriter1", "calm"],
  ["UCY1kMZp36IQSyNx_9h4mpCg", "Mark Rober", "craft"], ["UCj1VqrHhDte54oLgPG4xpuQ", "Stuff Made Here", "craft"],
  ["UCMOqf8ab-42UUQIdVoKwjlQ", "Practical Engineering", "craft"], ["UCy0tKL1T7wFoYcxCe0xjN6Q", "Technology Connections", "craft"],
  ["UCFhXFikryT4aFcLkLw2LBLA", "NileRed", "craft"], ["UCAL3JXZSzSm8AlZyD3nQdBA", "Primitive Technology", "calm"],
  ["UCEOXxzW2vU0P-0THehuIIeg", "Captain Disillusion", "funny"], ["UCSpFnDQr88xCZ80N-X7t0nQ", "Corridor Crew", "funny"],
  ["UCnkp4xDOwqqJD7sSM3xdUiQ", "Adam Neely", "funny"], ["UCRcgy6GzDeccI7dkbbBna3Q", "LEMMiNO", "weird"]
];
var ARCHIVE = [["prelinger", "Prelinger Archives", "weird"], ["classic_cartoons", "Classic Cartoons", "funny"], ["computerchronicles", "Computer Chronicles", "calm"], ["feature_films", "Public-domain feature films", "calm"]];
var MOODS = ["wonder", "craft", "weird", "funny", "calm"];

function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function dec(s) { return String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&"); }
async function get(url) {
  var c = new AbortController(); var t = setTimeout(function () { c.abort(); }, 6000);
  try {
    var r = await fetch(url, { signal: c.signal, headers: { "User-Agent": "personal-watch/" + VERSION }, cf: { cacheTtl: 1800, cacheEverything: true } });
    return r.ok ? await r.text() : "";
  } catch (e) { return ""; } finally { clearTimeout(t); }
}

async function fromYouTube(ch) {
  var xml = await get("https://www.youtube.com/feeds/videos.xml?channel_id=" + ch[0]); var out = [];
  var re = /<entry>[\s\S]*?<yt:videoId>([^<]+)<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>/g, m;
  while ((m = re.exec(xml)) && out.length < 12) out.push({ src: "youtube", id: m[1], title: dec(m[2]), by: ch[1], mood: ch[2], url: "https://www.youtube.com/watch?v=" + m[1] });
  return shuffle(out).slice(0, 3);
}
async function fromVimeo() {
  var xml = await get("https://vimeo.com/channels/staffpicks/videos/rss"); var out = [];
  var re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>https:\/\/vimeo\.com\/(?:channels\/staffpicks\/)?(\d+)/g, m;
  while ((m = re.exec(xml)) && out.length < 20) out.push({ src: "vimeo", id: m[2], title: dec(m[1]), by: "Vimeo Staff Picks", mood: out.length % 2 ? "wonder" : "funny", url: "https://vimeo.com/" + m[2] });
  return shuffle(out).slice(0, 6);
}
async function fromArchive(c) {
  var page = 1 + Math.floor(Math.random() * 20);
  var u = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent("collection:" + c[0] + " AND mediatype:movies") + "&fl[]=identifier&fl[]=title&rows=8&page=" + page + "&sort[]=downloads+desc&output=json";
  try {
    var j = JSON.parse(await get(u));
    return ((j.response && j.response.docs) || []).map(function (d) { return { src: "archive", id: d.identifier, title: dec(d.title), by: c[1], mood: c[2], url: "https://archive.org/details/" + d.identifier }; }).slice(0, 3);
  } catch (e) { return []; }
}

async function buildQueue(mood) {
  var lists = await Promise.all(YT.map(fromYouTube).concat([fromVimeo()], ARCHIVE.map(fromArchive)));
  var all = [].concat.apply([], lists);
  if (mood && MOODS.indexOf(mood) >= 0) all = all.filter(function (v) { return v.mood === mood; });
  // round-robin across sources so no channel runs twice in a row
  var by = {}; shuffle(all).forEach(function (v) { (by[v.by] = by[v.by] || []).push(v); });
  var names = shuffle(Object.keys(by)), q = [];
  for (var more = true; more;) { more = false; for (var i = 0; i < names.length; i++) { var v = by[names[i]].shift(); if (v) { q.push(v); more = true; } } }
  return q;
}

var CLIENT = `
var MOODS=["for-you","all","wonder","craft","weird","funny","calm"],Q=[],i=-1,ready=false,loadId=0;
function $(x){return document.getElementById(x)}
function readState(){try{var s=JSON.parse(localStorage.watchState||"{}");return s&&typeof s==="object"?s:{}}catch(e){return {}}}
var saved=readState();
function strings(a){return Array.isArray(a)?a.filter(function(x){return typeof x==="string"}):[]}
function legacyBan(){try{return JSON.parse(localStorage.ban||"[]")}catch(e){return []}}
var banned=strings(saved.banned||legacyBan()),seen=strings(saved.seen).slice(-300),likes=Array.isArray(saved.likes)?saved.likes.filter(function(x){return x&&typeof x.id==="string"}).slice(-100):[];
var oldMood=localStorage.m,mood=MOODS.indexOf(localStorage.watchMood)>=0?localStorage.watchMood:(MOODS.indexOf(oldMood)>=1?oldMood:"for-you");
function persist(){try{localStorage.watchState=JSON.stringify({banned:banned,seen:seen.slice(-300),likes:likes.slice(-100)});localStorage.watchMood=mood}catch(e){}}
function esc(s){return String(s||"").replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function button(action,label,extra){return '<button type="button" data-action="'+action+'" '+(extra||"")+'>'+label+'</button>'}
function bar(){
  var current=Q[i],liked=current&&likes.some(function(x){return x.id===current.src+":"+current.id});
  $("bar").innerHTML=MOODS.map(function(m){return '<button type="button" data-mood="'+m+'" aria-pressed="'+(m===mood)+'" class="'+(m===mood?"on":"")+'">'+(m==="for-you"?"For you":m==="all"?"All":m)+'</button>'}).join("")+
    button("prev","&larr; Previous")+button("next","Next &rarr;")+
    button("like",liked?"♥ Liked":"♡ Like",'aria-pressed="'+!!liked+'"')+
    button("skip-channel","Not this channel")+button("reshuffle","Reshuffle");
}
function score(v){return likes.reduce(function(n,x){return n+(x.by===v.by?3:0)+(x.mood===v.mood?1:0)},0)}
function personalize(q){
  var left=q.map(function(v,n){return {v:v,n:n,score:score(v)}}).sort(function(a,b){return b.score-a.score||a.n-b.n}),out=[],last="";
  while(left.length){var at=left.findIndex(function(x){return x.v.by!==last});if(at<0)at=0;var item=left.splice(at,1)[0];out.push(item.v);last=item.v.by}
  return out;
}
function setMood(m){if(MOODS.indexOf(m)<0)return;mood=m;persist();bar();load()}
async function load(resetHistory){
  var id=++loadId;
  if(resetHistory){seen=[];persist()}
  $("stage").textContent="Loading picks…";$("info").textContent="";
  try{
    var path="/api/queue"+(mood==="all"||mood==="for-you"?"":"?mood="+encodeURIComponent(mood)),r=await fetch(path);
    if(!r.ok)throw new Error("feed unavailable");
    var data=await r.json();
    if(id!==loadId)return;
    Q=(Array.isArray(data.queue)?data.queue:[]).filter(function(v){return v&&typeof v.id==="string"&&banned.indexOf(v.by)<0&&seen.indexOf(v.src+":"+v.id)<0});
    if(mood==="for-you")Q=personalize(Q);
    i=-1;bar();
    if(!Q.length){$("stage").textContent="";$("info").textContent="No unseen picks in this feed. Reshuffle to revisit recent videos.";return}
    next();
  }catch(e){if(id===loadId){Q=[];i=-1;$("stage").textContent="";$("info").textContent="The video feed could not load. Reshuffle to try again.";bar()}}
}
function next(){if(i+1>=Q.length){if(Q.length)load();return}i++;play()}
function prev(){if(i>0){i--;play()}}
function skipChannel(){var v=Q[i];if(!v)return;if(banned.indexOf(v.by)<0)banned.push(v.by);Q=Q.filter(function(x){return x.by!==v.by});persist();i--;bar();next()}
function toggleLike(){
  var v=Q[i];if(!v)return;
  var id=v.src+":"+v.id,at=likes.findIndex(function(x){return x.id===id});
  if(at>=0)likes.splice(at,1);else{likes.push({id:id,by:v.by,mood:v.mood});if(likes.length>100)likes.shift()}
  persist();bar();
}
function videoUrl(v){
  if(v.src==="youtube"&&/^[\\w-]{11}$/.test(v.id))return "https://www.youtube.com/watch?v="+encodeURIComponent(v.id);
  if(v.src==="vimeo"&&/^\\d+$/.test(v.id))return "https://vimeo.com/"+v.id;
  if(v.src==="archive"&&/^[\\w.-]+$/.test(v.id))return "https://archive.org/details/"+encodeURIComponent(v.id);
  return "#";
}
function play(){
  var v=Q[i];if(!v)return;
  var id=v.src+":"+v.id;if(seen.indexOf(id)<0)seen.push(id);if(seen.length>300)seen=seen.slice(-300);persist();bar();
  $("info").innerHTML="<b>"+esc(v.title)+"</b> &middot; "+esc(v.by)+" &middot; "+(i+1)+"/"+Q.length+" &middot; <a href=\\""+esc(videoUrl(v))+"\\" target=\\"_blank\\" rel=\\"noopener\\">open</a><small> Preferences and recent watches stay on this device.</small>";
  if(v.src==="youtube"){if(!ready){$("stage").textContent="Loading YouTube player…";return}$("stage").innerHTML="<div id=yt></div>";new YT.Player("yt",{videoId:v.id,playerVars:{autoplay:1,rel:0},events:{onStateChange:function(e){if(e.data===0)next()},onError:function(){next()}}})}
  else if(v.src==="vimeo")$("stage").innerHTML='<iframe title="Vimeo video player" allow="autoplay;fullscreen" allowfullscreen src="https://player.vimeo.com/video/'+encodeURIComponent(v.id)+'?autoplay=1"></iframe>';
  else if(v.src==="archive")$("stage").innerHTML='<iframe title="Internet Archive video player" allowfullscreen src="https://archive.org/embed/'+encodeURIComponent(v.id)+'"></iframe>';
  else $("stage").textContent="This video source is not supported.";
}
window.onYouTubeIframeAPIReady=function(){ready=true;if(Q[i]&&Q[i].src==="youtube")play()};
$("bar").addEventListener("click",function(e){
  var b=e.target.closest("button");if(!b)return;
  if(b.dataset.mood){setMood(b.dataset.mood);return}
  if(b.dataset.action==="prev")prev();
  else if(b.dataset.action==="next")next();
  else if(b.dataset.action==="like")toggleLike();
  else if(b.dataset.action==="skip-channel")skipChannel();
  else if(b.dataset.action==="reshuffle")load(true);
});
document.addEventListener("keydown",function(e){if(e.key==="ArrowRight")next();if(e.key==="ArrowLeft")prev()});
persist();bar();load();
`;

var PAGE = '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>watch</title>' +
  '<style>body{margin:0;background:#111;color:#eee;font:16px system-ui;display:flex;flex-direction:column;height:100vh}' +
  '#bar{display:flex;gap:6px;padding:8px;flex-wrap:wrap}button{background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:6px;padding:8px 12px;font:inherit;cursor:pointer}button.on,button[aria-pressed=true]{background:#e8b923;color:#111}button:focus-visible{outline:3px solid #fff;outline-offset:2px}' +
  '#stage{flex:1;min-height:0;position:relative}#stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
  '#info{padding:8px 12px;font-size:14px;color:#bbb}#info b{color:#fff}#info small{display:block;margin-top:4px;color:#888}a{color:#e8b923}</style>' +
  '<div id=bar></div><div id=stage></div><div id=info></div><script src="https://www.youtube.com/iframe_api"></script><script>' + CLIENT + '</script>';

export default {
  async fetch(req) {
    var u = new URL(req.url), h = { "Referrer-Policy": "strict-origin-when-cross-origin", "X-Content-Type-Options": "nosniff" };
    if (u.pathname === "/health") return Response.json({ worker: "personal-watch", version: VERSION, channels: YT.length }, { headers: h });
    if (u.pathname === "/api/queue") {
      var q = await buildQueue(u.searchParams.get("mood"));
      return Response.json({ version: VERSION, count: q.length, queue: q }, { headers: Object.assign({ "Cache-Control": "no-store" }, h) });
    }
    if (u.pathname === "/") return new Response(PAGE, { headers: Object.assign({ "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" }, h) });
    return new Response("not found", { status: 404, headers: h });
  }
};
