// 行为测试：线下剧场（novel）消息删除链路
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('index.html', 'utf8');

function slice(startMarker, endMarker) {
  const i = html.indexOf(startMarker);
  if (i < 0) throw new Error('start not found: ' + startMarker.slice(0, 40));
  const j = html.indexOf(endMarker, i);
  if (j < 0) throw new Error('end not found: ' + endMarker.slice(0, 40));
  return html.slice(i, j + endMarker.length);
}

const novelFnSrc = slice('function renderNovelContent() {', '}, 100);\n    }\n};');
const batchSrc = slice('    // 自动挂载引擎：再也不用去几万行代码里找 HTML 了！', 'document.querySelectorAll(\'#chatBox .msg-checkbox, #novelBox .msg-checkbox\').forEach(cb => cb.remove());\n    };');
const menuActionSrc = slice('        function menuAction(type) {', "            document.getElementById('msgMenu').classList.remove('active');\n        }\n");
const confirmSrc = slice('    window.confirmBatchDelete = async function() {', '} else if (typeof renderChatRoom === \'function\') {\n            renderChatRoom();\n        }\n    };');

const dom = new JSDOM('<!doctype html><html><body><div id="chatBox"></div><div id="novelBox"></div><div id="msgMenu"></div></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const document = window.document;

const session = {
  id: '1', name: '林深', avatar: 'a.png', history: [
    { side: 'me', type: 'text', content: '微信消息1', mode: 'chat' },
    { side: 'other', type: 'text', content: '线下第一句', mode: 'novel' },
    { side: 'me', type: 'text', content: '线下第二句', mode: 'novel' },
    { sys: '你撤回了一条消息', mode: 'novel' },
    { side: 'me', type: 'mind', content: '心声：心跳加速', mode: 'novel' },
    { side: 'other', type: 'text', content: '线下最后一句', mode: 'novel' }
  ]
};
window.sessions = [session];
window.currentSessionId = '1';
window.mySettings = { name: '我', avatar: 'me.png' };
window.getPersonaOf = () => null;
window.saveSessions = () => { window.__saved = (window.__saved || 0) + 1; };
window.makeRows = null;

// 微信侧渲染桩（真实 renderChatRoom 太大，此处只造行，验证多选逻辑本身）
window.renderChatRoom = function() {
  const box = document.getElementById('chatBox');
  box.innerHTML = session.history.map((m, i) => m.mode === 'novel' ? '' :
    `<div class="msg-row" data-index="${i}"><div class="msg-bubble"></div></div>`).join('');
};

window.eval(novelFnSrc);            // 真实 renderNovelContent
window.eval('(function(){' + batchSrc + '\n})();');  // 真实多选删除模块
window.eval(confirmSrc);            // 真实 confirmBatchDelete
window.eval(menuActionSrc);         // 真实 menuAction
window.pandaConfirm = async () => true;
window.confirm = () => { throw new Error('不应走原生 confirm'); };

let fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { fails++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

console.log('1) 线下渲染行与真实索引');
window.renderNovelContent();
const rows = [...document.querySelectorAll('#novelBox .msg-row')];
ok('行数=5 (2条剧情文本+1撤回+1心声+1剧情)'.replace('2条剧情文本', '3条剧情文本'), rows.length === 5, rows.length);
ok('data-index 与 history 下标一致', JSON.stringify(rows.map(r => r.getAttribute('data-index'))) === JSON.stringify(['1', '2', '3', '4', '5']),
  rows.map(r => r.getAttribute('data-index')));

console.log('2) 进入多选模式');
window.toggleBatchDeleteMode();
const cbs = [...document.querySelectorAll('#novelBox .msg-checkbox')];
ok('线下每条消息都出现 checkbox', cbs.length === 5, cbs.length);
ok('底部删除栏已插入', !!document.getElementById('batchActionBar'));
ok('输入栏进入锁定态', document.body.classList.contains('is-select-mode'));

console.log('3) 点击行勾选（含系统/心声行）');
const rowSys = rows[2], rowLast = rows[4];
rowSys.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
rowLast.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
ok('勾选集合=真实下标[3,5]', JSON.stringify(window.batchSelectedMsgs.slice().sort((a, b) => a - b)) === '[3,5]',
  window.batchSelectedMsgs);
ok('计数文本同步', document.getElementById('batchCount').innerText === '2', document.getElementById('batchCount').innerText);

console.log('4) 执行批量删除');
(async () => {
  await window.confirmBatchDelete();
  ok('history 减少 2 条', session.history.length === 4, session.history.length);
  const left = session.history.map(m => m.content || m.sys);
  ok('删掉的是撤回提示与最后一句', JSON.stringify(left) === JSON.stringify(['微信消息1', '线下第一句', '线下第二句', '心声：心跳加速']), left);
  const after = [...document.querySelectorAll('#novelBox .msg-row')];
  ok('界面同步刷新，剩 3 条', after.length === 3, after.length);
  ok('删除后退出多选模式', !document.body.classList.contains('is-select-mode'));
  ok('checkbox 已清理', document.querySelectorAll('#novelBox .msg-checkbox').length === 0);

  console.log('5) 分页折叠后仍能删除更早的记录');
  session.history = [
    { side: 'other', type: 'text', content: '很早的消息A', mode: 'novel' },
    { side: 'other', type: 'text', content: '很早的消息B', mode: 'novel' },
    { side: 'me', type: 'text', content: '最近一条', mode: 'novel' }
  ];
  window.novelRenderLimitCount = 2;
  window.renderNovelContent();
  window.toggleBatchDeleteMode();
  const r2 = [...document.querySelectorAll('#novelBox .msg-row')];
  ok('只渲染最近 2 条，索引仍是真实下标', JSON.stringify(r2.map(x => x.getAttribute('data-index'))) === '["1","2"]',
    r2.map(x => x.getAttribute('data-index')));
  r2[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await window.confirmBatchDelete();
  ok('删掉的是被折叠区里的 B', JSON.stringify(session.history.map(m => m.content)) === JSON.stringify(['很早的消息A', '最近一条']),
    session.history.map(m => m.content));

  console.log('6) 微信侧回归：批量删除仍可用');
  document.getElementById('novelBox').remove();
  session.history = [
    { side: 'me', type: 'text', content: '微信A', mode: 'chat' },
    { side: 'other', type: 'text', content: '微信B', mode: 'chat' },
    { side: 'other', type: 'text', content: '微信C', mode: 'chat' }
  ];
  window.renderChatRoom();
  window.toggleBatchDeleteMode();
  const crow = [...document.querySelectorAll('#chatBox .msg-row')];
  ok('微信行也出现 checkbox', crow.length === 3 && document.querySelectorAll('#chatBox .msg-checkbox').length === 3);
  crow[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await window.confirmBatchDelete();
  ok('微信删除生效', JSON.stringify(session.history.map(m => m.content)) === JSON.stringify(['微信B', '微信C']), session.history.map(m => m.content));

  console.log('7) 线下单条删除（菜单「删除」）');
  const nb = document.createElement('div'); nb.id = 'novelBox'; document.body.appendChild(nb);
  session.history = [
    { side: 'other', type: 'text', content: '单删A', mode: 'novel' },
    { side: 'other', type: 'text', content: '单删B', mode: 'novel' }
  ];
  window.novelRenderLimitCount = 20;
  window.renderNovelContent();
  window.selectedMsgIndex = 1;
  document.getElementById('msgMenu').classList.add('active');
  window.menuAction('delete');
  await new Promise(r => setTimeout(r, 0));
  ok('单条删除生效', JSON.stringify(session.history.map(m => m.content)) === JSON.stringify(['单删A']), session.history.map(m => m.content));
  ok('菜单已关闭', !document.getElementById('msgMenu').classList.contains('active'));

  console.log(fails === 0 ? '\nALL PASS' : '\nFAILURES: ' + fails);
  process.exit(fails === 0 ? 0 : 1);
})();
