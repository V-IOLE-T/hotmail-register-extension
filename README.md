# Hotmail Register Luckmail V2

独立的 Chrome MV3 扩展仓库，用于自动执行 OpenAI OAuth 注册 / 登录流程，并通过 Outlook 邮箱平台 API 获取可用邮箱、轮询验证码、在成功后自动打 “已注册” 标签。

## 核心亮点

- 可视化管理邮箱
  - 通过 Side Panel 和 Outlook Email 平台配合使用，邮箱状态、流程进度、验证码处理和账号切换都能直接可见，不再是纯脚本黑盒运行
- 支持自建各种域名邮箱
  - 邮箱来源不绑定单一公共后缀，依赖 Outlook Email 平台统一管理账号，适合接入不同域名、不同别名体系的邮箱资源，例如Outlook、Gmail、QQ、163、126、Yahoo、阿里邮箱以及自定义 IMAP 邮箱，或GPTMail、DuckMail、Cloudflare Temp Email 多提供商的临时邮箱。
- 注册完成后自动打标签，方便后续管理
  - 整轮认证流程真正完成后，插件才会回到 Outlook Email 平台，把当前邮箱打上 `已注册` 标签，后续筛号和复盘都会更直观
  - 避免重复消耗，避免因为插件中断、报错或手动调试中止，误把尚未注册成功、尚未完成认证的邮箱提前排除掉

## 测试结果

插件             |  CPA
:-------------------------:|:-------------------------:
![](https://github.com/user-attachments/assets/766ea771-77d0-40b9-8c42-5a1bcdfca413)  |  ![](https://github.com/user-attachments/assets/6f0f88e3-0297-4e08-9f87-6e7e3f888418)


## 快速开始

1. 安装本扩展
   - 打开 `chrome://extensions/`
   - 开启“开发者模式”
   - 点击“加载已解压的扩展程序”
   - 选择当前目录 `hotmail-register-extension`
2. 部署并启动 Outlook Email 服务
   - 使用仓库：[assast/outlookEmail](https://github.com/assast/outlookEmail/tree/main)
   - 确保你已经可以通过浏览器访问它的后台页面和 API
3. 配置插件
   - 在 Side Panel 中填写：
     - `API Key`
     - `API URL`
     - `CPA URL`
     - `管理密钥`
     - `默认登录密码`
4. 开始运行
   - 点击 `保存设置`
   - 点击 `自动运行`
5. 如果你是手动调试
   - 按 1 到 9 步顺序执行
   - 跑完第 9 步后，再点一次 `完成流程`
   - 这个按钮会负责：
     - 标记当前邮箱已用
     - 在 Outlook Email 中给该邮箱打 `已注册` 标签
     - 关闭 OpenAI 认证页

## 当前能力

- Chrome Side Panel 交互界面，支持：
  - `保存设置`
  - `自动运行 / 暂停 / 继续 / 重新开始 / 下一个账号`
  - 手动步骤执行
- 不再依赖手工维护账号池
  - 直接从 Outlook 邮箱平台 API 拉取未打 `已注册` 标签的邮箱
  - 自动跳过已在本地账本中标记为 `completed` 的邮箱
- 自动流程支持完整 9 步：
  1. 从 CPA 面板抓取 OAuth 链接
  2. 切到注册页
  3. 填写邮箱和密码
  4. 轮询注册验证码并回填
  5. 填写资料页
  6. 重新打开 OAuth 页面并执行登录
  7. 轮询登录验证码并回填
  8. 确认 OAuth 授权并捕获 localhost 回调
  9. 回填 CPA 校验
- Step 3 / Step 6 对注册流、登录流、验证码页、资料页都有更严格的页面识别
- 验证码轮询日志更细，包含：
  - 当前是第几轮、第几次检查
  - 距离超时剩余秒数
  - 是否命中新邮件 / 较早匹配邮件 / 邮件详情提取
- 对“刚好比轮询起点早几秒”的验证码邮件增加时间宽限窗口，降低“等到超时才回退旧邮件”的概率
- Step 8 的 Continue 点击采用双保险：
  - 先尝试页面内原生点击
  - 若未跳转，再自动补发调试器点击
- Step 9 不再刷新已有 CPA 标签页，而是优先复用旧页
- 整轮流程完成后会：
  - 关闭 OpenAI 认证页标签
  - 将当前邮箱写入本地已用账本
  - 通过内部 API 给 Outlook 平台邮箱记录打 `已注册` 标签

## 必要配置

- `API Key`
  Outlook 邮箱平台 API Key，用于拉取账号和轮询邮件
- `API URL`
  邮箱平台或内部后台地址，例如 `http://localhost:5000`
- `CPA URL`
  CPA 管理面板地址，例如 `http://ip:port/management.html#/oauth`
- `管理密钥`
  CPA 管理页登录密钥
- `默认登录密码`
  OpenAI 登录 / 注册优先使用的密码
- `轮数`
  自动流程要连续跑多少轮
- `轮询间隔`
  每隔多久检查一次验证码
- `轮询超时`
  单轮验证码轮询最多等待多久

## 自动流程

1. 填写 `API Key / API URL / CPA URL / 管理密钥 / 默认登录密码`
2. 点击 `保存设置`
3. 点击 `自动运行`

执行时会自动：

- 从 Outlook API 选一个未注册邮箱
- 抓取最新 OAuth 链接
- 打开认证页
- 跑完整个注册 / 登录 / 授权 / CPA 回填流程

流程中按钮行为：

- `自动运行`
  从头启动当前轮自动流程
- `暂停`
  当前步骤结束后暂停
- `继续`
  从当前中断 / 失败步骤继续
- `重新开始`
  从头重开当前流程
- `下一个账号`
  立刻切换到另一个未注册邮箱并重新开始当前轮

## 手动调试

侧边栏保留 9 个手动步骤按钮，可用于单步调试：

1. 获取 OAuth 链接
2. 进入注册流程
3. 填写邮箱和密码
4. 注册验证码：取码 / 回填
5. 填写基础资料
6. 刷新 OAuth 并登录
7. 登录验证码：取码 / 回填
8. 确认 OAuth 授权
9. CPA 回填校验

如果你是手动跑完第 9 步，还需要再点一次：

- `完成流程`

这个按钮会执行最终收尾：

- 标记当前邮箱为已用
- 在 Outlook 平台打 `已注册` 标签
- 关闭 OpenAI 认证页标签

## 成功后的结果

流程完整完成后会自动：

- 关闭 OpenAI 认证页
- 将当前邮箱加入本地 `usedAccounts`
- 调用内部 API 给对应平台邮箱记录打 `已注册` 标签

## 项目结构

```text
hotmail-register-extension/
├── background.js                # 后台主编排、自动流程、步骤调度、标签同步
├── manifest.json               # Chrome MV3 清单
├── content/                    # 注入 OpenAI / CPA 页面的内容脚本
│   ├── signup-page.js
│   ├── vps-panel.js
│   └── utils.js
├── shared/                     # 共享业务逻辑、状态机、helper、客户端
│   ├── auto-flow.js
│   ├── luckmail-client.js
│   ├── internal-session-client.js
│   ├── oauth-step-helpers-core.js
│   ├── open-oauth-target.js
│   └── ...
├── sidepanel/                  # Side Panel UI
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── tests/                      # node --test 测试集
├── docs/                       # 设计文档、实现计划
└── README.md
```

## 测试

```bash
npm test
```


当前测试覆盖：

- 自动流程编排
- 页面识别 helper
- 验证码轮询与重发恢复
- Step 8 / Step 9 状态判断
- Side Panel 结构约束

## 致谢
- 感谢 LinuxDo 上的每一位朋友的支持！欢迎加入 https://linux.do/ 进行各类技术交流、前沿 AI 资讯及 AI 使用经验分享。
- [Codex](https://openai.com/codex)-AI coding assistant by OpenAI
- 参考仓库：[QLHazyCoder/codex-oauth-automation-extension](https://github.com/QLHazyCoder/codex-oauth-automation-extension)
- Outlook Email 仓库：[assast/outlookEmail](https://github.com/assast/outlookEmail/tree/main)

## Star History

<a href="https://www.star-history.com/?repos=V-IOLE-T%2Fhotmail-register-extension&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=V-IOLE-T/hotmail-register-extension&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=V-IOLE-T/hotmail-register-extension&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=V-IOLE-T/hotmail-register-extension&type=date&legend=top-left" />
 </picture>
</a>
