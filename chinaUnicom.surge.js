/**
 * 中国联通 Surge 版 v1.1.1-port
 * - HTTP request 模式：抓取 token_online/appId 保存为 chinaUnicomCookie
 * - Cron/Panel 模式：执行常用任务：登录校验、资产查询、首页签到、签到区任务、月签有礼、天天领现金、通通乡村签到/任务(基础)
 * 说明：原 Python 体量较大，本 JS 版优先移植 Surge 环境中稳定可跑的核心链路；复杂云盘/安全管家/沃云手机/区域任务可继续增量迁移。
 */

const $ = new Env('中国联通');
const UA = 'Dalvik/2.1.0 (Linux; U; Android 12; Mi 10 Pro MIUI/21.11.3);unicom{version:android@11.0802}';
const H5_UA = 'Mozilla/5.0 (Linux; Android 10; MI 8 Build/QKQ1.190828.002; wv) AppleWebKit/537.36 Mobile Safari/537.36; unicom{version:android@11.0802,desmobile:0}';
const ENABLE_SIGN = readBool('UNICOM_ENABLE_SIGN', true);
const ENABLE_TTLXJ = readBool('UNICOM_ENABLE_TTLXJ', true);
const ENABLE_TTXC = readBool('UNICOM_ENABLE_TTXC', true);
const ENABLE_QUERY = readBool('UNICOM_ENABLE_QUERY', true);
const TEST_MODE = ($.getdata('UNICOM_TEST_MODE') || '').toLowerCase() === 'query';
const XJ_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const XJ_ACTIVITY_ID = `${$.getdata('XJ_ACTIVITY_MONTH') || XJ_MONTHS[new Date().getMonth()]}${$.getdata('XJ_ACTIVITY_YEAR') || new Date().getFullYear()}Act`;
const TTXC_BASE = 'https://epay.10010.com/cu-ca-game-front';
const TTXC_APP_BASE = 'https://epay.10010.com/cu-ca-app-front';
const TTXC_CHANNEL = '225';
const TTXC_REFERER = 'https://epay.10010.com/cu-ca-game-web/index.html?channel=qdqp';

!(async () => {
  if (typeof $request !== 'undefined') return captureToken();
  const raw = $.getdata('chinaUnicomCookie') || '';
  if (!raw) return finish('未找到 chinaUnicomCookie，请先打开中国联通 APP 触发抓取');
  const accounts = raw.split(/[&\n]/).map(x => x.trim()).filter(Boolean);
  const notify = [];
  $.log(`共 ${accounts.length} 个账号 | 签到:${ENABLE_SIGN} 天天领现金:${ENABLE_TTLXJ} 通通乡村:${ENABLE_TTXC} 查询模式:${TEST_MODE}`);
  for (let i = 0; i < accounts.length; i++) {
    const u = new UserService(i + 1, accounts[i]);
    if (!(await u.ensureLogin())) { u.log('登录失败/Token失效', true); notify.push(...u.notifyLogs); continue; }
    if (ENABLE_QUERY) await u.queryRemain();
    if (ENABLE_SIGN) await u.signTask(TEST_MODE);
    if (ENABLE_TTLXJ) await u.ttlxjTask(TEST_MODE);
    if (ENABLE_TTXC) await u.ttxcTask(TEST_MODE);
    notify.push(...u.notifyLogs);
    await wait(1500);
  }
  finish(notify.length ? notify.join('\n') : '执行完成，暂无通知内容');
})().catch(e => finish(`运行异常: ${e.stack || e}`));

function captureToken() {
  const url = $request.url || '';
  const headers = $request.headers || {};
  const cookie = headers.Cookie || headers.cookie || '';
  const body = $request.body || '';
  const token = pickParam(url, 'token_online') || pickParam(body, 'token_online') || pickCookie(cookie, 'token_online');
  const appId = pickParam(url, 'appId') || pickParam(body, 'appId') || pickCookie(cookie, 'appId');
  const mobile = pickParam(url, 'desmobile') || pickParam(body, 'desmobile') || pickCookie(cookie, 'desmobile') || pickParam(body, 'mobile');
  if (!token) return $.done({});
  const item = `${token}${appId ? '#'+appId : ''}${mobile && /^1\d{10}$/.test(mobile) ? '#'+mobile : ''}`;
  const old = $.getdata('chinaUnicomCookie') || '';
  const list = old ? old.split(/[&\n]/).filter(Boolean) : [];
  const idx = list.findIndex(x => (mobile && x.includes(mobile)) || x.split('#')[0] === token);
  if (idx >= 0) list[idx] = item; else list.push(item);
  $.setdata(list.join('&'), 'chinaUnicomCookie');
  $.msg('中国联通', 'Token 抓取成功', mask(mobile || token));
  $.done({});
}

class UserService {
  constructor(index, config) {
    this.index = index;
    this.notifyLogs = [];
    const p = config.split('#');
    this.token_online = p[0] || '';
    this.appId = p[1] || '';
    this.mobile = /^1\d{10}$/.test(p[2] || '') ? p[2] : '';
    this.uuid = $.getdata('chinaUnicomUuid') || randomString(32, '0123456789abcdef');
    $.setdata(this.uuid, 'chinaUnicomUuid');
    this.unicomTokenId = randomString(32);
    this.tokenIdCookie = 'chinaunicom-' + randomString(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    this.cookieString = `TOKENID_COOKIE=${this.tokenIdCookie}; UNICOM_TOKENID=${this.unicomTokenId}; sdkuuid=${this.unicomTokenId}; token_online=${this.token_online}` + (this.appId ? `; appId=${this.appId}` : '');
    this.ecs_token = '';
    this.city_info = [];
    this.ttxc_token = '';
  }
  log(msg, notify=false) { const line = `账号[${this.index}]${msg}`; $.log(`[${time()}] ${line}`); if (notify) this.notifyLogs.push(line); }
  headers(extra={}) { return {'User-Agent': UA, 'Connection':'keep-alive', 'Cookie': this.cookieString, ...extra}; }
  async request(method, url, opts={}) {
    const headers = {...this.headers(), ...(opts.headers || {})};
    if (opts.cookie) headers.Cookie = `${headers.Cookie || ''}; ${opts.cookie}`;
    try { return await http(method, url, {...opts, headers}); } catch(e) { this.log(`请求异常 ${url}: ${e}`); return null; }
  }
  async ensureLogin(max=3) {
    for (let i=1;i<=max;i++) { if (i>1) this.log(`登录重试 ${i}/${max}`); if (await this.onLine()) return true; await wait(1200); }
    return false;
  }
  async onLine() {
    if (!this.token_online) return false;
    const data = {isFirstInstall:'1', netWay:'Wifi', version:'android@11.0000', token_online:this.token_online, provinceChanel:'general', deviceModel:'ALN-AL10', step:'dingshi', androidId:'291a7deb1d716b5a', reqtime:Date.now()};
    if (this.appId) data.appId = this.appId;
    const r = await this.request('post', 'https://m.client.10010.com/mobileService/onLine.htm', {form:data});
    const j = parseJson(r?.body);
    if (j && (j.code === '0' || j.code === 0)) {
      const des = j.desmobile || '';
      if (/^1\d{10}$/.test(des)) this.mobile = des;
      this.ecs_token = j.ecs_token || ''; this.city_info = j.list || [];
      this.log(`登录成功 ${mask(this.mobile)}`);
      return true;
    }
    this.log(`登录失败[${j?.code ?? '?'}]: ${j?.msg || ''}`);
    return false;
  }
  async queryRemain() {
    if (!this.ecs_token) return;
    this.log('==== 资产查询 ====');
    const r = await this.request('get', 'https://m.client.10010.com/servicequerybusiness/balancenew/accountBalancenew.htm', {headers:{'User-Agent':UA, 'Cookie':`ecs_token=${this.ecs_token}`}});
    const j = parseJson(r?.body);
    if (j?.code === '0000') {
      const bal = j.curntbalancecust || '0.00', fee = j.realfeecust || '0.00';
      this.log(`💰 [资产-话费] 当前余额: ${bal}元, 实时话费: ${fee}元`, true);
    } else this.log(`套餐余量查询失败: ${j?.desc || j?.msg || '未知错误'}`);
  }
  async signTask(query=false) {
    this.log('==== 首页签到/签到区 ====');
    await this.signGetTelephone(true);
    await this.signGetContinuous(query);
    if (!query) await this.signGetTaskList();
    await this.signMonthGift(query);
    await this.signGetTelephone(false);
  }
  async signGetContinuous(query=false) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/signin/getContinuous', {params:{taskId:'', channel:'wode', imei:this.uuid}});
    const j = parseJson(r?.body);
    if (j?.code === '0000') {
      const signed = j.data?.todayIsSignIn === 'y'; this.log(`签到区今天${signed ? '已' : '未'}签到`, true);
      if (!signed && !query) await this.signDaySign();
    } else this.log(`签到区查询签到状态失败[${j?.code || '?'}]: ${j?.desc || ''}`);
  }
  async signDaySign() {
    const r = await this.request('post', 'https://activity.10010.com/sixPalaceGridTurntableLottery/signin/daySign', {form:{}});
    const j = parseJson(r?.body);
    if (j?.code === '0000') this.log(`签到区签到成功: [${j.data?.statusDesc || ''}]${j.data?.redSignMessage || ''}`, true);
    else if (j?.code === '0002' && String(j.desc||'').includes('已经签到')) this.log('签到区签到成功: 今日已完成签到！');
    else this.log(`签到区签到失败[${j?.code || '?'}]: ${j?.desc || ''}`);
  }
  async signGetTelephone(initial=false) {
    const r = await this.request('post', 'https://act.10010.com/SigninApp/convert/getTelephone', {form:{}});
    const j = parseJson(r?.body);
    if (j?.status === '0000' && j.data) {
      const amount = Number(j.data.telephone || 0);
      if (initial) this.initialAmount = amount;
      else this.log(`签到区-话费红包: 总额 ${amount.toFixed(2)}元`, true);
      return amount;
    }
    return null;
  }
  async signGetTaskList() {
    const url = 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/taskList';
    for (let i=0;i<20;i++) {
      const r = await this.request('get', url, {params:{type:'2'}, headers:{Referer:'https://img.client.10010.com/'}});
      const j = parseJson(r?.body);
      if (!j || j.code !== '0000') { this.log(`签到区-任务中心: 获取任务列表失败[${j?.code || '?'}]: ${j?.desc || ''}`); return; }
      const tags = j.data?.tagList || [], tasks = [...(j.data?.taskList || []), ...tags.flatMap(t => t.taskDTOList || [])].filter(Boolean);
      const doTask = tasks.find(t => t.taskState === '1' && t.taskType === '5');
      if (doTask) { await this.signDoTask(doTask); await wait(2000); continue; }
      const claim = tasks.find(t => t.taskState === '0');
      if (claim) { await this.signGetTaskReward(claim.id); await wait(1000); continue; }
      this.log('签到区-任务中心: 所有任务处理完毕。'); break;
    }
  }
  async gettaskip() { const orderId = randomString(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'); await this.request('post', 'https://m.client.10010.com/taskcallback/topstories/gettaskip', {form:{mobile:this.mobile, orderId}}); return orderId; }
  async signDoTask(task) {
    if (task.url && task.url !== '1' && /^http/.test(task.url)) { await this.request('get', task.url, {headers:{Referer:'https://img.client.10010.com/'}}); await wait(3500); }
    const orderId = await this.gettaskip();
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/completeTask', {params:{taskId:task.id, orderId, systemCode:'QDQD'}});
    const j = parseJson(r?.body);
    this.log(`签到区-任务中心: ${j?.code === '0000' ? '✅' : '❌'} 任务[${task.taskName}] ${j?.desc || ''}`);
  }
  async signGetTaskReward(taskId) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/getTaskReward', {params:{taskId}});
    const j = parseJson(r?.body), d = j?.data || {};
    if (j?.code === '0000' && d.code === '0000') this.log(`签到区-领取奖励: [${d.prizeName || ''}] ${d.prizeNameRed || ''}`, true);
    else this.log(`签到区-领取奖励失败[${d.code || j?.code || '?'}]: ${j?.desc || d.desc || ''}`);
  }
  async signMonthGift(query=false) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/floor/getMonthSign', {headers:{Referer:'https://img.client.10010.com/'}});
    const j = parseJson(r?.body); if (j?.code !== '0000') return this.log(`签到区-月签有礼: 查询失败[${j?.code || '?'}]: ${j?.desc || ''}`);
    const tasks = j.data?.taskList || [], claim = tasks.filter(t => String(t.taskStatus)==='1' && t.taskId && t.id);
    if (query) return this.log(`签到区-月签有礼: 可领取 ${claim.length} 个，已领取 ${tasks.filter(t=>String(t.taskStatus)==='2').length} 个`);
    for (const t of claim) { await this.signGetMonthReward(t); await wait(800); }
  }
  async signGetMonthReward(t) {
    const r = await this.request('get', 'https://activity.10010.com/sixPalaceGridTurntableLottery/task/getTaskReward', {params:{taskId:t.taskId, taskType:'30', id:t.id}, headers:{Referer:'https://img.client.10010.com/'}});
    const j = parseJson(r?.body), d = j?.data || {};
    if (j?.code === '0000' && d.code === '0000') this.log(`签到区-月签有礼: [${t.taskName || '月签奖励'}] ${d.prizeName || ''} ${d.prizeNameRed || ''}`, true);
    else this.log(`签到区-月签有礼领取失败: ${d.desc || j?.desc || ''}`);
  }
  async openPlatLineNew(toUrl) {
    if (!this.ecs_token) return null;
    const r = await this.request('get', 'https://m.client.10010.com/mobileService/openPlatform/openPlatLineNew.htm', {params:{to_url:toUrl}, headers:{Cookie:`ecs_token=${this.ecs_token}`}, followRedirect:false});
    const loc = r?.headers?.Location || r?.headers?.location || '';
    return {location:loc, ticket:(loc.match(/[?&]ticket=([^&]+)/)||[,''])[1]};
  }
  async ttlxjTask(query=false) {
    this.log('==== 天天领现金 ====');
    const jump = await this.openPlatLineNew('https://epay.10010.com/ci-mps-st-web/');
    if (!jump?.location) return this.log('天天领现金: 获取入口失败');
    const loginUrl = await this.ttlxjAuthorize(jump.location);
    if (!loginUrl) return;
    await this.ttlxjLogin(loginUrl);
    if (query) return await this.ttlxjQueryAvailable();
    await this.ttlxjDoTasks();
    await this.ttlxjDraw('CYCLE');
    await this.ttlxjQueryAvailable();
  }
  async ttlxjAuthorize(location) {
    let r = await this.request('get', location, {headers:{'User-Agent':H5_UA}, followRedirect:false});
    const loc = r?.headers?.Location || r?.headers?.location || '';
    return loc || location;
  }
  async ttlxjLogin(loginUrl) { const r = await this.request('get', loginUrl, {headers:{'User-Agent':H5_UA}, followRedirect:true}); this.log(`天天领现金: 登录${r ? '完成' : '失败'}`); }
  async ttlxjDoTasks() {
    const r = await this.request('post', 'https://epay.10010.com/ci-mps-st-web/v1/ttlxj/task', {json:{activityId:XJ_ACTIVITY_ID}, headers:{'User-Agent':H5_UA, Origin:'https://epay.10010.com'}});
    const j = parseJson(r?.body); const list = j?.data?.taskList || j?.taskList || [];
    for (const t of list.filter(x => ['0','1',0,1].includes(x.status))) {
      await this.request('post', 'https://epay.10010.com/ci-mps-st-web/v1/ttlxj/task/finish', {json:{activityId:XJ_ACTIVITY_ID, taskId:t.taskId || t.id}, headers:{'User-Agent':H5_UA, Origin:'https://epay.10010.com'}});
      this.log(`天天领现金: 执行任务 ${t.taskName || t.name || t.taskId}`); await wait(1000);
    }
  }
  async ttlxjDraw(type) {
    const r = await this.request('post', 'https://epay.10010.com/ci-mps-st-web/v1/ttlxj/unifyDrawNew', {json:{activityId:XJ_ACTIVITY_ID, drawType:type}, headers:{'User-Agent':H5_UA, Origin:'https://epay.10010.com'}});
    const j = parseJson(r?.body); this.log(`天天领现金: 抽奖结果 ${j?.msg || j?.message || responseSummary(j)}`, true);
  }
  async ttlxjQueryAvailable() {
    const r = await this.request('post', 'https://epay.10010.com/ci-mps-st-web/v1/ttlxj/queryAvailable', {json:{activityId:XJ_ACTIVITY_ID}, headers:{'User-Agent':H5_UA, Origin:'https://epay.10010.com'}});
    const j = parseJson(r?.body); const amt = j?.data?.amount || j?.data?.availableAmount || j?.amount;
    if (amt != null) this.log(`天天领现金: 可用金额 ${amt}`, true);
  }
  ttxcHeaders(auth=true) { const h = {'User-Agent':H5_UA, Referer:TTXC_REFERER, Origin:'https://epay.10010.com', 'Content-Type':'application/json'}; if (auth && this.ttxc_token) h.Authorization = this.ttxc_token; return h; }
  async ttxcPost(path, payload={}, auth=true) { const r = await this.request('post', `${TTXC_BASE}${path}`, {json:payload, headers:this.ttxcHeaders(auth)}); return parseJson(r?.body) || {}; }
  async ttxcTask(query=false) {
    this.log('==== 通通乡村 ====');
    const ok = await this.ttxcLogin(); if (!ok) return;
    await this.ttxcSign(query); if (query) return;
    const tasks = await this.ttxcGetTasks();
    for (const t of tasks.filter(x => !['FINISH','DONE','RECEIVED'].includes(String(x.status||x.taskStatus).toUpperCase()))) { await this.ttxcFinishTask(t); await wait(1000); }
  }
  async ttxcLogin() {
    const jump = await this.openPlatLineNew(TTXC_REFERER); if (!jump?.location) { this.log('通通乡村: 获取入口失败'); return false; }
    await this.request('get', jump.location, {headers:{'User-Agent':H5_UA}, followRedirect:true});
    const r = await this.request('post', `${TTXC_APP_BASE}/user/login`, {json:{channel:TTXC_CHANNEL}, headers:this.ttxcHeaders(false)});
    const j = parseJson(r?.body); this.ttxc_token = j?.data?.token || j?.token || '';
    this.log(`通通乡村: 登录${this.ttxc_token ? '成功' : '失败'}`); return !!this.ttxc_token;
  }
  async ttxcSign(query=false) { const j = await this.ttxcPost('/sign/signInfo', {}, true); if (query) return this.log(`通通乡村: 签到状态 ${j?.data?.signed ? '已签到' : '未签到'}`); if (!j?.data?.signed) { const r = await this.ttxcPost('/sign/sign', {}, true); this.log(`通通乡村: 签到 ${r?.msg || responseSummary(r)}`, true); } }
  async ttxcGetTasks() { const j = await this.ttxcPost('/task/list', {}, true); const list = j?.data?.taskList || j?.data?.list || j?.taskList || []; this.log(`通通乡村: 查询到 ${list.length} 个任务`); return list; }
  async ttxcFinishTask(t) { const id = t.taskId || t.id || t.taskCode; const name = t.taskName || t.name || id; const j = await this.ttxcPost('/task/finish', {taskId:id}, true); this.log(`通通乡村: 任务[${name}] ${j?.msg || responseSummary(j)}`); }
}

function pickParam(s,k){ try { const m = String(s||'').match(new RegExp(`(?:[?&#]|^)${k}=([^&#&\\s]+)`)); return m ? decodeURIComponent(m[1]) : ''; } catch { return ''; } }
function pickCookie(c,k){ const m = String(c||'').match(new RegExp(`${k}=([^;]+)`)); return m ? m[1] : ''; }
function readBool(k,d){ const v=$.getdata(k); return v==null||v===''?d:!['0','false','False','FALSE'].includes(v); }
function mask(s){ s=String(s||''); if(/^1\d{10}$/.test(s)) return s.slice(0,3)+'****'+s.slice(7); return s.length>12 ? s.slice(0,6)+'******'+s.slice(-6) : s; }
function randomString(n, chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'){ let r=''; for(let i=0;i<n;i++) r+=chars[Math.floor(Math.random()*chars.length)]; return r; }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function time(){ const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }
function parseJson(s){ try { return typeof s === 'object' ? s : JSON.parse(s || '{}'); } catch { return null; } }
function responseSummary(j){ if(!j || typeof j !== 'object') return String(j || '接口返回异常'); return j.message || j.msg || j.desc || j.resultMsg || j.rsp_desc || '接口返回异常'; }
function http(method, url, opts={}) { return new Promise((resolve,reject)=>{ const params = {...opts, url}; if (opts.params) { const q = Object.entries(opts.params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); params.url += (params.url.includes('?')?'&':'?') + q; delete params.params; } if (opts.json) { params.body = JSON.stringify(opts.json); params.headers = {...(params.headers||{}), 'Content-Type':'application/json'}; delete params.json; } if (opts.form) { params.body = Object.entries(opts.form).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); params.headers = {...(params.headers||{}), 'Content-Type':'application/x-www-form-urlencoded'}; delete params.form; } const cb=(e,r,b)=> e ? reject(e) : resolve({status:r.status, headers:r.headers||{}, body:b}); method=method.toLowerCase(); $httpClient[method](params, cb); }); }
function finish(content){ $.log(content); $.msg('中国联通自动任务', '', content); $.done(); }
function Env(name){ return {name, log:(...a)=>console.log(...a), msg:(t,s,b)=>$notification.post(t,s,b), getdata:k=>$persistentStore.read(k), setdata:(v,k)=>$persistentStore.write(v,k), done:(v={})=>$done(v)} }
