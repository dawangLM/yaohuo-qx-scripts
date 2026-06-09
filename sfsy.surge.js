/**
 * 顺丰速运 Surge 版 v1.1.0-port
 * - HTTP request 模式：自动抓取 Cookie 保存为 sfsyUrl
 * - Cron/Panel 模式：签到、日常积分任务、会员日(26-28)、端午活动
 * 说明：Surge 不支持 Python，本文件为 JS 移植版，使用 $persistentStore 保存账号。
 */

const $ = new Env('顺丰速运');
const TOKEN = 'wwesldfs29aniversaryvdld29';
const SYS_CODE = 'MCS-MIMP-CORE';
const BASE = 'https://mcs-mimp-web.sf-express.com';
const ENABLE_DAILY_TASK = readBool('SF_ENABLE_DAILY_TASK', true);
const ENABLE_MEMBER_DAY = readBool('SF_ENABLE_MEMBER_DAY', true);
const ENABLE_DRAGON_BOAT = readBool('SF_ENABLE_DRAGON_BOAT', true);
const DRAGON_BOAT_ACTIVITY_CODE = 'DRAGONBOAT_2026';
const DRAGON_BOAT_LOW_VALUE_LIMIT = 12;
const DAILY_SKIP_TASKS = ['用行业模板寄件下单', '用积分兑任意礼品', '参与积分活动', '每月累计寄件', '完成每月任务', '去使用AI寄件'];
const MEMBER_DAY_SKIP_TASK_TYPES = ['SEND_SUCCESS', 'INVITEFRIENDS_PARTAKE_ACTIVITY', 'OPEN_SVIP', 'OPEN_NEW_EXPRESS_CARD', 'OPEN_FAMILY_CARD', 'CHARGE_NEW_EXPRESS_CARD', 'INTEGRAL_EXCHANGE'];
const CK_INVALID_KEYWORDS = ['未登录','请登录','请先登录','登录失效','登录已失效','登录过期','会话失效','session失效','sessionid失效','sessionid已失效','token失效','重新登录','not_login','unauthorized'];
const DRAGON_EXCLUDE = [/9折寄件券/, /(?:^|[^1])2元寄件券/, /92折寄件券/, /2元寄件券[（(]满20元可用[）)]/, /海底捞7\.9折夜宵券/, /5元寄件券/];

setTimeout(() => {
  main().catch(e => finish(`运行异常: ${formatError(e)}`));
}, 0);

async function main() {
  if (typeof $request !== 'undefined') return captureCookie();
  const raw = $.getdata('sfsyUrl') || $.getdata('sfsy_cookie') || '';
  if (!raw) return finish('未找到 sfsyUrl，请先打开顺丰速运小程序触发抓取');
  const accounts = raw.split('&').map(x => x.trim()).filter(Boolean);
  const allUserIds = accounts.map(a => safeDecode(a.split('#')[0])).map(a => (a.match(/_login_user_id_=([^;#&]+)/) || [,''])[1]).filter(Boolean);
  $.log(`共 ${accounts.length} 个账号 | 日常:${ENABLE_DAILY_TASK} 会员日:${ENABLE_MEMBER_DAY} 端午:${ENABLE_DRAGON_BOAT}`);
  const results = [];
  for (let i = 0; i < accounts.length; i++) {
    results.push(await runAccount(accounts[i], i, allUserIds));
    await wait(1500);
  }
  let totalEarned = 0, totalDragonGold = 0;
  const lines = [];
  for (const r of results) {
    const phone = maskPhone(r.phone) || '未登录';
    totalEarned += r.points_earned || 0;
    totalDragonGold += r.dragon_gold || 0;
    if (r.ck_invalid) lines.push(`❌ ${phone}: CK失效了`);
    else if (!r.success) lines.push(`❌ ${phone}: ${r.fail_reason || '登录失败'}`);
    else {
      const parts = [`积分+${r.points_earned || 0}`];
      if ((r.member_day_prizes || []).length) parts.push(`会员日: ${r.member_day_prizes.join(', ')}`);
      if (ENABLE_DRAGON_BOAT) parts.push(`端午金币${r.dragon_gold || 0}`);
      const dp = filterDragonPrizes(r.dragon_prizes || []);
      if (dp.length) parts.push(`端午奖品: ${dp.join(', ')}`);
      lines.push(`✅ ${phone}: ${parts.join(' | ')}`);
    }
  }
  lines.push(`📱 总账号: ${results.length} | 💰 总积分+${totalEarned}` + (ENABLE_DRAGON_BOAT ? ` | 端午金币${totalDragonGold}` : ''));
  finish(lines.join('\n'));
}

function captureCookie() {
  const cookie = $request.headers.Cookie || $request.headers.cookie || '';
  if (!cookie || !/sessionId=|_login_mobile_=|_login_user_id_=/.test(cookie)) return $.done({});
  const keep = [];
  for (const k of ['sessionId', '_login_mobile_', '_login_user_id_']) {
    const m = cookie.match(new RegExp(`${k}=([^;]+)`));
    if (m) keep.push(`${k}=${m[1]}`);
  }
  if (keep.length < 2) return $.done({});
  const ck = keep.join(';');
  const old = $.getdata('sfsyUrl') || '';
  const phone = (ck.match(/_login_mobile_=([^;]+)/) || [,''])[1];
  const uid = (ck.match(/_login_user_id_=([^;]+)/) || [,''])[1];
  const list = old ? old.split('&').filter(Boolean) : [];
  const idx = list.findIndex(x => (uid && x.includes(`_login_user_id_=${uid}`)) || (phone && x.includes(`_login_mobile_=${phone}`)));
  const isNewOrChanged = idx < 0 || list[idx] !== ck;
  if (idx >= 0) list[idx] = ck; else list.push(ck);
  $.setdata(list.join('&'), 'sfsyUrl');
  const notifyKey = `sfsy_cookie_notified_${uid || phone || md5(ck)}`;
  if (isNewOrChanged && $.getdata(notifyKey) !== '1') {
    $.setdata('1', notifyKey);
    $.msg('顺丰速运', 'Cookie 抓取成功', maskPhone(phone) || uid || '');
  }
  $.done({});
}

async function runAccount(accountRaw, index, allUserIds) {
  const logger = new Logger(`账号${index + 1}`);
  const account = accountRaw.split('#')[0].trim();
  const http = new SFHttpClient(account, logger);
  const login = http.login();
  if (!login.success) return {success:false, phone:'', index, points_earned:0, dragon_gold:0, dragon_prizes:[], member_day_prizes:[], ck_invalid:true, fail_reason:'CK失效了'};
  logger.success(`【${maskPhone(login.phone)}】登录成功`);
  const result = {success:true, phone:login.phone, index, points_before:0, points_after:0, points_earned:0, member_day_prizes:[], dragon_gold:0, dragon_prizes:[], ck_invalid:false};
  if (ENABLE_DAILY_TASK) {
    const daily = new DailyTaskExecutor(http, logger, login.userId);
    await daily.dualSignIn();
    await wait(800);
    await daily.signIn();
    const [pb, pa] = await daily.run();
    result.points_before = pb; result.points_after = pa; result.points_earned = pa - pb;
  }
  if (ENABLE_MEMBER_DAY) {
    const d = new Date().getDate();
    if (d >= 26 && d <= 28) result.member_day_prizes = (await new MemberDayExecutor(http, logger, login.userId).run()).lottery_prizes || [];
    else logger.info('未到会员日(26-28号)，跳过');
  }
  if (ENABLE_DRAGON_BOAT) {
    const dr = await new DragonBoatExecutor(http, logger, login.userId, login.phone, allUserIds).run();
    result.dragon_gold = dr.gold_coin || 0; result.dragon_prizes = dr.prizes || [];
  }
  if (http.ckInvalid) { result.success = false; result.ck_invalid = true; result.fail_reason = http.ckInvalidMessage || 'CK失效了'; }
  return result;
}

class SFHttpClient {
  constructor(cookie, logger) {
    this.cookie = safeDecode(cookie);
    this.logger = logger;
    this.ckInvalid = false;
    this.ckInvalidMessage = '';
    this.headers = {
      'Host': 'mcs-mimp-web.sf-express.com', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.63 miniProgram/wxd4185d00bf7e08ac',
      'Accept': 'application/json, text/plain, */*', 'Content-Type': 'application/json', 'channel': 'xcxpart', 'platform': 'MINI_PROGRAM', 'accept-language': 'zh-CN,zh;q=0.9', 'Cookie': this.cookie
    };
  }
  login() {
    const phone = (this.cookie.match(/_login_mobile_=([^;]+)/) || [,''])[1];
    const userId = (this.cookie.match(/_login_user_id_=([^;]+)/) || [,''])[1];
    return {success: !!phone, phone, userId};
  }
  signHeaders() { const timestamp = String(Date.now()); return {syscode: SYS_CODE, timestamp, signature: md5(`token=${TOKEN}&timestamp=${timestamp}&sysCode=${SYS_CODE}`)}; }
  async post(url, data = {}, extra = {}) {
    const headers = {...this.headers, ...this.signHeaders(), ...extra};
    const res = await httpPost(url, headers, data);
    if (res && typeof res === 'object') this.checkCkInvalid(res);
    return res;
  }
  async postApp(url, data = {}) { return this.post(url, data, {'platform':'SFAPP'}); }
  checkCkInvalid(result) {
    if (!result || result.success === true) return;
    const text = ['errorMessage','message','msg','error','code','errorCode'].map(k => String(result[k] || '')).join(' ').toLowerCase();
    if (CK_INVALID_KEYWORDS.some(k => text.includes(k))) { this.ckInvalid = true; this.ckInvalidMessage = result.errorMessage || result.message || result.msg || 'CK失效了'; }
  }
}

class DailyTaskExecutor {
  constructor(http, logger, userId) { this.http = http; this.logger = logger; this.userId = userId; this.totalPoints = 0; }
  deviceId() { return 'xxxxxxxx-xxxx-xxxx'.replace(/x/g, () => 'abcdef0123456789'[Math.floor(Math.random()*16)]); }
  extractTaskId(url) { try { const m = decodeURIComponent(url).match(/"taskId"\s*:\s*"?([^,"}]+)/); return m ? String(m[1]) : ''; } catch { return ''; } }
  async signV2(platform) {
    const headers = platform === 'SFAPP' ? {'platform':'SFAPP','channel':'doudiappwd','deviceid':this.deviceId()} : {'platform':'MINI_PROGRAM','channel':'wxwddoudi'};
    const name = platform === 'SFAPP' ? 'APP' : '小程序';
    const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~integralSignV2Service~sign`, {}, headers);
    if (r?.success) { this.logger.success(`[${name}签到] 成功`); return true; }
    const msg = r?.errorMessage || '请求失败';
    if (msg.includes('今日已签到')) { this.logger.info(`[${name}签到] 今日已签到`); return true; }
    this.logger.error(`[${name}签到] 失败: ${msg}`); return false;
  }
  async dualSignIn() { await this.signV2('SFAPP'); await wait(1000); return this.signV2('MINI_PROGRAM'); }
  async signIn() {
    const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~integralTaskSignPlusService~automaticSignFetchPackage`, {comeFrom:'vioin', channelFrom:'WEIXIN'});
    if (r?.success) { this.logger.success('旧签到接口成功/已签到'); return [true, '']; }
    const msg = r?.errorMessage || '请求失败'; this.logger.error(`签到失败: ${msg}`); return [false, msg];
  }
  async getTaskList() {
    const url = `${BASE}/mcs-mimp/commonPost/~memberNonactivity~integralTaskStrategyService~queryPointTaskAndSignFromES`;
    const all = [], seen = new Set();
    for (const ct of ['1','2','3','4','01','02','03','04']) {
      const r = await this.http.post(url, {channelType:ct, deviceId:this.deviceId()});
      if (r?.success && r.obj) {
        if (ct === '1') this.totalPoints = Number(r.obj.totalPoint || 0);
        for (const t of (r.obj.taskTitleLevels || [])) {
          let tc = t.taskCode || (t.buttonRedirect ? this.extractTaskId(t.buttonRedirect) : '');
          if (tc && !seen.has(tc)) { t.taskCode = tc; seen.add(tc); all.push(t); }
        }
      }
    }
    return all;
  }
  async execute(taskCode) { const r = await this.http.post(`${BASE}/mcs-mimp/commonRoutePost/memberEs/taskRecord/finishTask`, {taskCode}); return !!r?.success; }
  async receive(t) { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~integralTaskStrategyService~fetchIntegral`, {strategyId:t.strategyId||0, taskId:String(t.taskId||''), taskCode:t.taskCode, deviceId:this.deviceId()}); if (r?.success) this.logger.success(`领取奖励: ${t.title}`); return !!r?.success; }
  async run() {
    this.logger.info('━━━ 日常积分任务 ━━━');
    let tasks = await this.getTaskList(); if (!tasks.length) return [0,0];
    const before = this.totalPoints; this.logger.points(before, '执行前积分');
    for (const t of tasks) {
      const title = t.title || '未知'; if (t.status === 3 || DAILY_SKIP_TASKS.includes(title)) continue;
      if (!t.taskCode) continue; this.logger.task(`发现任务: ${title} (状态: ${t.status})`);
      if (t.status === 1) { if (await this.execute(t.taskCode)) { this.logger.success(`[${title}] 提交成功`); await wait(1500); t.status = 2; } }
      if (t.status === 2) { if (!(await this.receive(t))) { await this.execute(t.taskCode); await wait(1200); await this.receive(t); } }
      await wait(1800);
    }
    tasks = await this.getTaskList(); const after = tasks.length ? this.totalPoints : before; this.logger.points(after, '执行后积分'); return [before, after];
  }
}

class MemberDayExecutor {
  constructor(http, logger, userId) { this.http = http; this.logger = logger; this.userId = userId; this.black = false; }
  async getIndex() { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~memberDayIndexService~index`, {inviteUserId:''}); if (r?.success) return r.obj || {}; this.logger.info(`查询会员日失败: ${r?.errorMessage || '请求失败'}`); return null; }
  async lottery() { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~memberDayLotteryService~lottery`, {}); if (r?.success) { const p = r.obj?.productName || '空气'; this.logger.success(`会员日抽奖: ${p}`); return p; } this.logger.info(`会员日抽奖失败: ${r?.errorMessage || '请求失败'}`); return null; }
  async taskList() { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~activityTaskService~taskList`, {activityCode:'MEMBER_DAY', channelType:'MINI_PROGRAM'}); return r?.success ? (r.obj || []) : []; }
  async finish(task) { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberEs~taskRecord~finishTask`, {taskCode:task.taskCode}); if (r?.success) await this.fetchReward(task); return !!r?.success; }
  async fetchReward(task) { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~activityTaskService~fetchMixTaskReward`, {taskType:task.taskType, activityCode:'MEMBER_DAY', channelType:'MINI_PROGRAM'}); if (r?.success) this.logger.success(`领取会员日任务[${task.taskName}]奖励`); }
  async redPacketStatus() { await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~memberDayPacketService~redPacketStatus`, {}); }
  async doTasks() { const tasks = await this.taskList(); for (const t of tasks.filter(x => x.status === 1)) await this.fetchReward(t); for (const t of tasks.filter(x => x.status === 2 && !MEMBER_DAY_SKIP_TASK_TYPES.includes(x.taskType))) for (let i=0;i<Number(t.restFinishTime||0);i++) await this.finish(t); }
  async run() { this.logger.info('━━━ 会员日活动 ━━━'); const result = {lottery_prizes:[]}; const idx = await this.getIndex(); if (!idx) return result; await this.redPacketStatus(); const n = Number(idx.lotteryNum || 0); this.logger.info(`会员日可抽奖 ${n} 次`); for (let i=0;i<n;i++) { const p = await this.lottery(); if (p) result.lottery_prizes.push(p); await wait(1000); } await this.doTasks(); await this.redPacketStatus(); return result; }
}

class DragonBoatExecutor {
  constructor(http, logger, userId, phone, allUserIds) { this.http=http; this.logger=logger; this.userId=userId; this.phone=phone; this.allUserIds=allUserIds; this.prizes=[]; }
  addPrize(g,d='') { this.prizes.push(`${g}${d ? '，'+d : ''}`); }
  async fetchReward() { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~dragonBoat2026TaskService~fetchTaskReward`, {channelType:'MINI_PROGRAM', activityCode:DRAGON_BOAT_ACTIVITY_CODE}); if (r?.success) this.logger.success('端午领取奖励成功'); }
  async taskBrowse() { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~activityTaskService~taskList`, {activityCode:DRAGON_BOAT_ACTIVITY_CODE, channelType:'MINI_PROGRAM'}); const b = (r?.obj || []).find(x => x.taskType === 'BROWSE_LIFE_SERVICE'); if (!b) return; if (b.status === 2 && b.taskCode) await this.http.post(`${BASE}/mcs-mimp/commonRoutePost/memberEs/taskRecord/finishTask`, {taskCode:b.taskCode}); if ((b.canReceiveTokenNum||0) > 0 || b.status === 1) await this.fetchReward(); }
  async balance(currency) { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~dragonBoat2026ZongziService~queryStatus`, {}); const it = (r?.obj?.currentAccountList || []).find(x => x.currency === currency); return Number(it?.balance || 0); }
  async crush() { const z = await this.balance('GOLD_ZONGZI'); this.logger.info(`端午当前金粽: ${z}`); const max = Number($.getdata('SF_DRAGONBOAT_MAX_CRUSH') || 20); for (let i=0;i<Math.min(z,max);i++) { const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~dragonBoat2026ZongziService~crush`, {}); if (!r?.success) break; let coin=0; for (const it of (r.obj?.receivedAccountList || [])) { if (it.currency === 'GOLD_COIN') coin += Number(it.amount||0); else this.addPrize(`${it.currencyName || it.currency} x${it.amount}`, '砸金粽获得'); } const aw = r.obj?.extraCardType === 'SURPRISE' ? r.obj.award : null; if (aw) this.addPrize(aw.couponName || aw.productName || '惊喜礼盒', `x${aw.amount || 1} 惊喜礼盒`); this.logger.success(`端午第${i+1}次砸粽: 获得${coin}金币`); await wait(800); } }
  async lottery() { if ($.getdata('SF_DRAGONBOAT_LOTTERY') !== '1') return; const c = await this.balance('GOLD_COIN'); if (c < 2000) return this.logger.info(`端午金币不足2000，当前${c}`); const r = await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~dragonBoat2026LotteryService~prizeDraw`, {ruleType:'LOTTERY', shouldNum:2000}); if (r?.success) { const p = r.obj?.giftBagName || '未知奖品'; this.logger.success(`端午金币抽奖: ${p}`); this.addPrize(p); } }
  async run() { this.logger.info('━━━ 端午活动 ━━━'); await this.http.post(`${BASE}/mcs-mimp/commonPost/~memberNonactivity~dragonBoat2026IndexService~index`, {}); await this.taskBrowse(); await this.crush(); await this.lottery(); const gold = await this.balance('GOLD_COIN'); this.logger.points(gold, '端午当前金币'); return {gold_coin:gold, prizes:this.prizes}; }
}

class Logger { constructor(prefix){this.prefix=prefix;} line(i,m){ $.log(`${i} ${this.prefix} ${m}`); } info(m){this.line('📝',m)} success(m){this.line('✅',m)} error(m){this.line('❌',m)} task(m){this.line('🎯',m)} points(p,pre='当前积分'){this.line('💰',`${pre}: 【${p}】`)} }
function readBool(k,d){ const v=$.getdata(k); return v==null||v===''?d:!['0','false','False','FALSE'].includes(v); }
function safeDecode(s){ try { return decodeURIComponent(String(s || '')); } catch { return String(s || ''); } }
function formatError(e){ return (e && (e.stack || e.message)) ? (e.stack || e.message) : String(e); }
function maskPhone(p){ return p && p.length>=7 ? p.slice(0,3)+'****'+p.slice(7) : (p||''); }
function isLowValue(text){ if (!/[券红包]/.test(text)) return false; const ms = text.match(/(\d+(?:\.\d+)?)\s*元/g)||[]; return ms.some(x => parseFloat(x) < DRAGON_BOAT_LOW_VALUE_LIMIT); }
function filterDragonPrizes(ps){ return ps.filter(p => !DRAGON_EXCLUDE.some(r=>r.test(p)) && !isLowValue(p)); }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function httpPost(url, headers, body){ return new Promise(resolve => $httpClient.post({url, headers, body: JSON.stringify(body)}, (e,r,d)=>{ if(e) return resolve(null); try{resolve(JSON.parse(d));}catch{resolve(null);} })); }
function finish(content){ $.log(content); $.msg('顺丰速运自动任务', '', content); $.done(); }

function Env(name){ return {name, log:(...a)=>console.log(...a), msg:(t,s,b)=>$notification.post(t,s,b), getdata:k=>$persistentStore.read(k), setdata:(v,k)=>$persistentStore.write(v,k), done:(v={})=>$done(v)} }

// blueimp-md5 compatible tiny implementation
function md5(s){function L(k,d){return(k<<d)|(k>>>(32-d))}function K(G,k){var I,d,F,H,x;F=G&2147483648;H=k&2147483648;I=G&1073741824;d=k&1073741824;x=(G&1073741823)+(k&1073741823);if(I&d)return x^2147483648^F^H;if(I|d){if(x&1073741824)return x^3221225472^F^H;else return x^1073741824^F^H}else return x^F^H}function r(d,F,k){return(d&F)|((~d)&k)}function q(d,F,k){return(d&k)|(F&(~k))}function p(d,F,k){return d^F^k}function n(d,F,k){return F^(d|(~k))}function u(G,F,aa,Z,k,H,I){G=K(G,K(K(r(F,aa,Z),k),I));return K(L(G,H),F)}function f(G,F,aa,Z,k,H,I){G=K(G,K(K(q(F,aa,Z),k),I));return K(L(G,H),F)}function D(G,F,aa,Z,k,H,I){G=K(G,K(K(p(F,aa,Z),k),I));return K(L(G,H),F)}function t(G,F,aa,Z,k,H,I){G=K(G,K(K(n(F,aa,Z),k),I));return K(L(G,H),F)}function e(G){var Z;var F=G.length;var x=F+8;var k=(x-(x%64))/64;var I=(k+1)*16;var aa=Array(I-1);var d=0;var H=0;while(H<F){Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=(aa[Z]|(G.charCodeAt(H)<<d));H++}Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=aa[Z]|(128<<d);aa[I-2]=F<<3;aa[I-1]=F>>>29;return aa}function B(x){var k='',F='',G,d;for(d=0;d<=3;d++){G=(x>>>(d*8))&255;F='0'+G.toString(16);k=k+F.substr(F.length-2,2)}return k}function J(k){k=k.replace(/\r\n/g,'\n');var d='';for(var F=0;F<k.length;F++){var x=k.charCodeAt(F);if(x<128)d+=String.fromCharCode(x);else if((x>127)&&(x<2048)){d+=String.fromCharCode((x>>6)|192);d+=String.fromCharCode((x&63)|128)}else{d+=String.fromCharCode((x>>12)|224);d+=String.fromCharCode(((x>>6)&63)|128);d+=String.fromCharCode((x&63)|128)}}return d}var C=Array();var P,h,E,v,g,Y,X,W,V;var S=7,Q=12,N=17,M=22;var A=5,z=9,y=14,w=20;var o=4,m=11,l=16,j=23;var U=6,T=10,R=15,O=21;s=J(s);C=e(s);Y=1732584193;X=4023233417;W=2562383102;V=271733878;for(P=0;P<C.length;P+=16){h=Y;E=X;v=W;g=V;Y=u(Y,X,W,V,C[P+0],S,3614090360);V=u(V,Y,X,W,C[P+1],Q,3905402710);W=u(W,V,Y,X,C[P+2],N,606105819);X=u(X,W,V,Y,C[P+3],M,3250441966);Y=u(Y,X,W,V,C[P+4],S,4118548399);V=u(V,Y,X,W,C[P+5],Q,1200080426);W=u(W,V,Y,X,C[P+6],N,2821735955);X=u(X,W,V,Y,C[P+7],M,4249261313);Y=u(Y,X,W,V,C[P+8],S,1770035416);V=u(V,Y,X,W,C[P+9],Q,2336552879);W=u(W,V,Y,X,C[P+10],N,4294925233);X=u(X,W,V,Y,C[P+11],M,2304563134);Y=u(Y,X,W,V,C[P+12],S,1804603682);V=u(V,Y,X,W,C[P+13],Q,4254626195);W=u(W,V,Y,X,C[P+14],N,2792965006);X=u(X,W,V,Y,C[P+15],M,1236535329);Y=f(Y,X,W,V,C[P+1],A,4129170786);V=f(V,Y,X,W,C[P+6],z,3225465664);W=f(W,V,Y,X,C[P+11],y,643717713);X=f(X,W,V,Y,C[P+0],w,3921069994);Y=f(Y,X,W,V,C[P+5],A,3593408605);V=f(V,Y,X,W,C[P+10],z,38016083);W=f(W,V,Y,X,C[P+15],y,3634488961);X=f(X,W,V,Y,C[P+4],w,3889429448);Y=f(Y,X,W,V,C[P+9],A,568446438);V=f(V,Y,X,W,C[P+14],z,3275163606);W=f(W,V,Y,X,C[P+3],y,4107603335);X=f(X,W,V,Y,C[P+8],w,1163531501);Y=f(Y,X,W,V,C[P+13],A,2850285829);V=f(V,Y,X,W,C[P+2],z,4243563512);W=f(W,V,Y,X,C[P+7],y,1735328473);X=f(X,W,V,Y,C[P+12],w,2368359562);Y=D(Y,X,W,V,C[P+5],o,4294588738);V=D(V,Y,X,W,C[P+8],m,2272392833);W=D(W,V,Y,X,C[P+11],l,1839030562);X=D(X,W,V,Y,C[P+14],j,4259657740);Y=D(Y,X,W,V,C[P+1],o,2763975236);V=D(V,Y,X,W,C[P+4],m,1272893353);W=D(W,V,Y,X,C[P+7],l,4139469664);X=D(X,W,V,Y,C[P+10],j,3200236656);Y=D(Y,X,W,V,C[P+13],o,681279174);V=D(V,Y,X,W,C[P+0],m,3936430074);W=D(W,V,Y,X,C[P+3],l,3572445317);X=D(X,W,V,Y,C[P+6],j,76029189);Y=D(Y,X,W,V,C[P+9],o,3654602809);V=D(V,Y,X,W,C[P+12],m,3873151461);W=D(W,V,Y,X,C[P+15],l,530742520);X=D(X,W,V,Y,C[P+2],j,3299628645);Y=t(Y,X,W,V,C[P+0],U,4096336452);V=t(V,Y,X,W,C[P+7],T,1126891415);W=t(W,V,Y,X,C[P+14],R,2878612391);X=t(X,W,V,Y,C[P+5],O,4237533241);Y=t(Y,X,W,V,C[P+12],U,1700485571);V=t(V,Y,X,W,C[P+3],T,2399980690);W=t(W,V,Y,X,C[P+10],R,4293915773);X=t(X,W,V,Y,C[P+1],O,2240044497);Y=t(Y,X,W,V,C[P+8],U,1873313359);V=t(V,Y,X,W,C[P+15],T,4264355552);W=t(W,V,Y,X,C[P+6],R,2734768916);X=t(X,W,V,Y,C[P+13],O,1309151649);Y=t(Y,X,W,V,C[P+4],U,4149444226);V=t(V,Y,X,W,C[P+11],T,3174756917);W=t(W,V,Y,X,C[P+2],R,718787259);X=t(X,W,V,Y,C[P+9],O,3951481745);Y=K(Y,h);X=K(X,E);W=K(W,v);V=K(V,g)}return(B(Y)+B(X)+B(W)+B(V)).toLowerCase()}
