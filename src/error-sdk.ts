/* eslint-disable general/prefer-template -- this file emits vanilla JS as a string */
/**
 * Standalone browser error-tracking SDK (Sentry-style).
 *
 * Served as a static script; the site configures it with a DSN:
 *   <script src=".../sdk.js"></script>
 *   <script>TSA.init({ dsn: "https://<ingestKey>@host/<siteId>" })</script>
 *
 * init() parses the DSN, installs global error/unhandledrejection handlers, and
 * exposes captureException/captureMessage. Events POST to /errors/collect with
 * the ingest key (X-Analytics-Token). Persistent scope (setUser/setTag) +
 * breadcrumbs are layered on in #71/#75.
 */
export function generateErrorSdk(): string {
  return `(function(g){
  'use strict';
  var cfg={endpoint:'',key:'',siteId:'',environment:'production',release:'',sampleRate:1};
  var scope={user:null,tags:{},extra:{}};
  function merge(a,b){var o={},k;for(k in a){o[k]=a[k];}if(b){for(k in b){o[k]=b[k];}}return o;}
  var crumbs=[];
  function crumb(c){try{c.ts=new Date().toISOString();crumbs.push(c);if(crumbs.length>20){crumbs.shift();}}catch(e){}}
  function instrument(){
    try{g.addEventListener('click',function(e){var t=e.target||{};var d=((t.tagName||'')+'').toLowerCase()+(t.id?('#'+t.id):'');crumb({category:'ui.click',message:d});},true);}catch(e){}
    try{var hp=history.pushState;history.pushState=function(){crumb({category:'navigation',message:String(arguments[2]||location.pathname)});return hp.apply(this,arguments);};}catch(e){}
    try{g.addEventListener('popstate',function(){crumb({category:'navigation',message:location.pathname});});}catch(e){}
    ['error','warn'].forEach(function(lvl){try{var orig=console[lvl];console[lvl]=function(){crumb({category:'console.'+lvl,message:Array.prototype.slice.call(arguments).join(' ').slice(0,200)});return orig.apply(console,arguments);};}catch(e){}});
    try{var of=g.fetch;if(of){g.fetch=function(){var u=arguments[0];crumb({category:'fetch',message:((typeof u==='string')?u:((u&&u.url)||'')).slice(0,200)});return of.apply(this,arguments);};}}catch(e){}
  }
  function parseDsn(dsn){try{var u=new URL(dsn);cfg.key=u.username||'';cfg.siteId=u.pathname.replace(/^\\//,'');cfg.endpoint=u.protocol+'//'+u.host+'/errors/collect';}catch(e){}}
  function send(p){if(!cfg.endpoint||!cfg.key)return;if(cfg.sampleRate<1&&Math.random()>cfg.sampleRate)return;try{var x=new XMLHttpRequest();x.open('POST',cfg.endpoint,true);x.setRequestHeader('Content-Type','application/json');x.setRequestHeader('X-Analytics-Token',cfg.key);x.send(JSON.stringify(p));}catch(e){}}
  function build(err,o){o=o||{};var hasStack=err&&err.stack;return{message:(err&&err.message)?String(err.message):String(err),type:(err&&err.name)?err.name:'Error',stack:hasStack?String(err.stack).slice(0,4000):'',url:location.href,environment:cfg.environment,release:cfg.release,level:o.level||'error',tags:merge(scope.tags,o.tags),user:o.user||scope.user,extra:merge(scope.extra,o.extra),breadcrumbs:crumbs.slice(-20),sdkVersion:'tsa-sdk/1'};}
  var TSA={
    init:function(o){o=o||{};if(o.dsn)parseDsn(o.dsn);if(o.key)cfg.key=o.key;if(o.endpoint)cfg.endpoint=o.endpoint;if(o.environment)cfg.environment=o.environment;if(o.release)cfg.release=o.release;if(typeof o.sampleRate==='number')cfg.sampleRate=o.sampleRate;
      instrument();
      g.addEventListener('error',function(ev){send(build(ev.error||ev.message,{}));});
      g.addEventListener('unhandledrejection',function(ev){var r=ev.reason;send(build((r&&r.message)?r:('Unhandled Promise: '+r),{}));});
      return TSA;},
    captureException:function(err,o){send(build(err,o));},
    captureMessage:function(msg,level){send({message:String(msg),type:'Message',level:level||'info',url:location.href,environment:cfg.environment,release:cfg.release,tags:merge(scope.tags,{}),user:scope.user,extra:merge(scope.extra,{}),breadcrumbs:crumbs.slice(-20),sdkVersion:'tsa-sdk/1'});},
    addBreadcrumb:function(c){crumb(c||{});return TSA;},
    setUser:function(u){scope.user=u;return TSA;},
    setTag:function(k,v){scope.tags[k]=v;return TSA;},
    setTags:function(t){scope.tags=merge(scope.tags,t);return TSA;},
    setContext:function(k,v){scope.extra[k]=v;return TSA;},
    clearScope:function(){scope={user:null,tags:{},extra:{}};return TSA;}
  };
  g.TSA=TSA;
})(window);`
}
