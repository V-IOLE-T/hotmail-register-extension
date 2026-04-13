# Thread Handoff - 2026-04-13 - AppleMail Alias Follow-up

## 这轮线程实际完成了什么

### 1. 主流程稳定性修复

已经完成并通过测试：

- 修复了自动流程从 Step 1 继续时会漏执行 Step 2 的问题
- 收紧了 Step 3 对“已进入登录流 / 已注册账号”的误判
- 自动流程启动前会清理上一轮残留运行态
- Step 9 尾部做了两项优化：
  - 成功状态识别更快
  - OAuth 成功后会自动关闭 OpenAI 认证页和 `localhost` 回调页
- Step 5 不再使用固定资料，改为本地随机英文姓名/年龄/生日，并且同一账号单轮重试保持稳定

这部分改动是有效的，不是误改方向。

### 2. 错误方向的实现

后面我把“别名注册系统”错误地接到了 `Outlook/Luckmail` 这一支：

- 新增了 `shared/hotmail-aliases.js`
- 改了 `shared/luckmail-client.js`
- 改了 `background.js`、`sidepanel/sidepanel.js`
- 改了部分账本与测试，让 Outlook/Luckmail 账号自动展开成 5 个 `+suffix` 别名

这部分方向是错的。

用户在最后明确说明：

- **不是 Outlook/Luckmail**
- **目标应该是 AppleMail**

所以当前工作区里，“主流程稳定性修复”应保留；“Hotmail alias 接在 Luckmail 上”这部分不要继续往下堆功能。

## 当前工作区状态

当前 `git status` 中有这些改动：

- 主流程修复相关：
  - `background.js`
  - `content/signup-page.js`
  - `content/vps-panel.js`
  - `shared/auto-flow.js`
  - `shared/auto-restart.js`
  - `shared/oauth-step-helpers-core.js`
  - `shared/oauth-step-helpers-runtime.js`
  - `shared/signup-step-executor.js`
  - `shared/state-machine.js`
  - `shared/step9-status.js`
  - `shared/profile-generator.js`
  - 对应测试若干
- 错误方向的别名实现：
  - `shared/hotmail-aliases.js`
  - `shared/luckmail-client.js`
  - `shared/account-ledger.js`
  - `sidepanel/sidepanel.js`
  - `background.js` 里和 `baseAddress / isAlias / aliasIndex` 相关的 Luckmail 分支
  - 对应别名测试若干

当前全量测试是通过的：

```bash
npm test
```

结果为：

- `139/139` 通过

注意：测试通过不代表方向正确，因为这些测试已经把错误方向的 Luckmail 别名行为也一起固化了。

## 用户最新明确需求

用户的真实需求是：

- 加入一个“Hotmail 别名邮箱系统”
- 参考外部 HTML 的规则生成别名
- 注册时填写别名邮箱
- 查询验证码时仍然使用原邮箱
- 但这个系统应该挂在 **AppleMail** 这条线，而不是 Outlook/Luckmail

当前可以确认的业务语义：

- 输入账号池格式仍然保持：`原邮箱----密码----clientId----refreshToken`
- 一个原邮箱需要生成 5 个别名
- 注册消耗应按别名粒度，而不是按原邮箱粒度
- 取码邮箱始终是原邮箱

## 下一线程应该先做什么

### 先做拆分判断，不要直接继续在当前基础上改

下一线程建议先把工作分成两部分：

1. **保留主流程稳定性修复**
2. **把错误接到 Luckmail 的别名逻辑从设计上挪走，改接到 AppleMail**

### 建议执行顺序

1. 先审查并保留本轮有效修复
   - Step 2/3 自动流程问题
   - Step 9 关页与提速
   - Step 5 随机资料

2. 再处理错误方向的别名接入
   - 判断是“回退 Luckmail 别名实现”还是“把别名层抽成 provider 级能力，再只给 AppleMail 开启”
   - 不建议继续在当前 Luckmail alias 代码上直接打补丁

3. 明确 AppleMail 的真实接入点
   - `shared/appleemail-client.js`
   - `accountPoolText` 这套账号来源
   - `background.js` 里 `buildClient()` 返回的 AppleMail 分支

4. 用 AppleMail 语义重新实现
   - 原邮箱账号池解析后，在 AppleMail 分支展开 5 个别名
   - 注册用 `currentAccount.address`
   - 查信 / 详情 / 记录定位用 `currentAccount.baseAddress`
   - 账本按别名地址记

## 下一线程的技术注意点

### A. 有效改动应保留

下面这些是本轮已经验证有效的，不要误回退：

- `Step 1 -> Step 2 -> Step 3` 自动流程时序修复
- `Step 3` 登录流误判收紧
- `Step 9` 成功识别提速
- `localhost` 回调页自动关闭
- `Step 5` 随机资料生成与 runtime 缓存

### B. 错误方向改动的主要位置

如果要回退或迁移 Luckmail alias，优先看这些文件：

- `shared/hotmail-aliases.js`
- `shared/luckmail-client.js`
- `shared/account-ledger.js`
- `background.js`
- `sidepanel/sidepanel.js`
- `tests/hotmail-aliases.test.js`
- `tests/luckmail-client.test.js`
- `tests/account-ledger.test.js`

### C. AppleMail 实现的建议落点

别名系统更适合接在：

- `shared/appleemail-client.js`
  - 当前这里直接把 `accountPoolText` 每行转成一个账号对象
  - 应改成：原账号 -> 展开 5 个别名账号
- `background.js`
  - `ensureCurrentEmailRecord()` 与 `pollCodeForPhase()` 要优先使用 `baseAddress`
- `shared/account-ledger.js`
  - 账本键应允许按别名地址记完成

### D. 不要重复踩的坑

- 不要把“原邮箱带 `已注册` 标签”直接用于过滤 AppleMail 的 5 个别名候选
- 不要让 `findUserEmailByAddress()` 在“可注册账号列表”和“平台原邮箱记录查找”之间混用同一套数据
- 不要让随机别名每次重新解析都变化，否则继续执行 / 手动指定 / 账本都会漂移

## 推荐下一线程的首个验证目标

不要一上来追求全量功能，先验证这条最小链路：

1. AppleMail 原账号池中 1 个 `hotmail/outlook` 原邮箱
2. 插件内部展示为 5 个别名候选
3. Step 3 注册页实际填入别名
4. Step 4 轮询邮件时实际查询原邮箱
5. 成功后只把该别名标记为 completed
6. 同一个原邮箱还剩 4 个别名可继续注册

## 给下一个线程的结论

一句话总结：

- **主流程修复可以沿用**
- **别名系统的接入 provider 搞错了，当前接到了 Outlook/Luckmail，实际应该改到 AppleMail**

