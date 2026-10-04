Original prompt: 用新安装的游戏开发技能重做「太空金币冒险」：保留果果/点点飞艇、60 秒收金币躲作业本的核心玩法，可扩展（道具、连击、阶段、BOSS、纪录），手感（震屏/卡帧/粒子/挤压拉伸/金币磁吸/连击字）、合成音效+背景音乐（静音可保存，严格的 iOS 音频规则）、视差星空与非模板化标题页、安全区 HUD、手机竖屏/横屏触控 + 电脑键盘、60fps；纯静态网页、中文界面；旧版保留在 /v1/。

## v2 重制（2026-10-04）
- 旧版：/v1/index.html（原 app.js/engine.mjs/audio.mjs/style.css 原样复制），git tag `v1-before-remake`（指向 5c450d6）
- 新版文件：index.html（结构+CSS）、game.js（全部逻辑，单个 IIFE）、icon.svg；index.html 引用 `game.js?v=<时间戳>`，每次发布改这个戳
- 测试接口：`window.render_game_to_text()`、`window.advanceTime(ms)`、`window.__game`（setT/power/hurt/start/select/pause/audio/bg/track/session）
- `?test=1`：主循环只渲染不推进，完全由 advanceTime 驱动（确定性测试）
- 存档：localStorage `sca2_save`（version=1 的 JSON，写前把旧值复制到 `sca2_save_bak`，解析失败回退备份）；含 muted/music/shake/flash/ship/best/top/plays
- 测试脚本（工作区，不在仓库）：/workspace/scav-test/feat.py（交互/弹窗/暂停/后台/存档，Chromium+WebKit，竖屏 430x932 + 横屏 932x430 触屏）、play.py+bot.js（机器人整局）、smoke.py、perf.py

### 设计要点
- 节奏（level-design 张弛曲线）：0–9s 热身 → 9–22s 金币航道（整排金币，收齐 +10）→ 22–28s 金币雨（无作业本，喘息+奖励）→ 28–45s 作业风暴（左右飘、寒假作业大本）→ 45–60s 生气的班主任（扔作业扇形弹 / 红笔圈，先预警再出手）→ 下课铃
- 道具按时间表投放（先教后考）：11s 磁铁、24s 爱心、31.5s 护盾、39s 双倍、50s 磁铁、55.5s 爱心（满血时换成护盾/双倍）
- 连击：1.6s 内连续收集；8/20/40 连击 → ×2/×3/×4；被撞清零
- 角色技能保持原版：果果号每 10 金币一架僚机（最多 4 架，可挡作业本/红笔），点点号每 5 金币一道激光（收金币、烧作业本）
- 奖牌：铜 200 / 银 500 / 金 900（满分机器人约 1500–1700）
- 手感：创伤值震屏（可调强/弱/关）、受伤卡帧 0.13s、受伤红色暗角（可关闪光）、飞艇弹簧挤压拉伸、金币弹出+自旋+磁吸+飞向计分板、飘字、粒子池（700 个，不分配）
- 音频：沿用羽毛球版的 iOS 解锁方案（touchend/click/pointerdown/keydown 里 audioUnlock，处理 'interrupted'，卡住 600ms 后下次点按重建）；后台/pagehide/blur → 暂停 + 静音 + 停音乐 + suspend + audioSession='auto'；音序器在隐藏时不排音符；三首合成 BGM（登机口/航行/班主任）

### 验证记录（2026-10-04）
- feat.py：Chromium + WebKit × 竖屏/横屏触屏，35 项全部 PASS（弹窗 ✕/Esc/背景关闭、拖动/键盘、道具、护盾、受伤、暂停/继续、设置叠在暂停上、visibilitychange/blur/pagehide、存档、静音持久化、无控制台错误）
- audio.py（模拟 navigator.audioSession）：点按前不建 AudioContext；点按 → 'playback'+running+音乐；隐藏 → 'auto'+suspended+无音乐、隐藏期间 0 个新振荡器、隐藏时点按无效；回前台仍静音暂停直到点「继续冒险」
- 性能：Chromium 无节流全程 60fps，每帧 JS+绘制 ≤1ms（金币雨最忙时）；4× CPU 节流下 2–5ms。WebKit 无头（Linux 软件合成）40–60fps——真机 Safari 走 GPU
- 机器人（play.py，贪心、贴着可移动区域顶部）满分局 1400–1800；会在 0–3 颗心之间波动，人类玩家预计 300–1000 → 奖牌门槛 200/500/900
- 飞艇可移动区域限制在 HUD 以下 24% 之后（避免挡住 HUD、也避免顶到刚生成的作业本）

## TODO / 建议
- 真机 iPhone 确认：静音键开时有声、来电/切 App 后回来点「继续冒险」才恢复
- 可考虑：更多飞艇皮肤（用最高分解锁）、每日挑战种子
