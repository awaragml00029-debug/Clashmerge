# AGENTS.md

ClashMerge 是一个 Node.js/Express 项目，用于订阅聚合、节点解析、Clash/Mihomo 配置生成、分组规则管理和辅助转换工具。

## 工作目录

- 项目目录：`/root/clash/clashmerge`
- 主要入口：`index.js`
- 后端路由：`routes/`
- 原生解析/生成：`services/native/`
- 前端页面：`public/index.html`、`public/index.js`、`public/index.css`
- 持久数据：`data/config.json`

## 项目偏好

- 优先沿现有结构做小范围修改，不引入新的大框架或复杂抽象。
- 原生转换器是主路径；不要恢复旧的外部转换依赖作为默认路径。
- `exportMergeMode` 只影响导出行为；内部节点池保持去重边界，不要混淆内部状态和导出状态。
- 默认规则不要额外加规则；只有用户显式选择 ACL4SSR 或自定义规则时才加。
- ACL4SSR 规则必须服务端解析成本地 `proxy-groups` + `rules`：
  - 不依赖客户端 `rule-providers` 下载。
  - 服务端可以访问 GitHub raw。
  - 输出中不要包含客户端需要下载的 `rule-providers`。
  - 过滤 Clash/Mihomo 不支持的规则类型，例如 Surge 的 `URL-REGEX`。
- `🚀 手动切换` 不作为最终独立代理组输出；它和 `🚀 节点选择` 重复。
- `🚀 节点选择` 主选择组只放：`♻️ 自动选择`、真实节点、`DIRECT`。
  - 国旗/地区组可以保留给规则策略引用。
  - 国旗/地区组不要挂进 `🚀 节点选择`，避免和真实节点重复显示。
- 手动域名后缀规则应插在规则列表前面，优先级高于预设规则。
- SS `v2ray-plugin` websocket 必须按 Mihomo 结构输出：
  - `plugin: v2ray-plugin`
  - `plugin-opts.mode: websocket`
  - 支持 `tls`、`host`、`path`、`mux`。
- Mihomo 标准节点 YAML 转分享链接工具要支持完整 `proxies:`、节点数组和单个节点对象。
  - 当前目标输出包括 `ss://`、`trojan://`、`vmess://`、`vless://`、`ssr://`。

## 发布偏好

- GitHub 推送必须使用 SSH alias：`github2aw`。
- 目标远端分支是 `main`。
- 不要创建或推送远端 `master`。
- 不要读取私有 SSH key 内容。
- 推送命令示例：

```bash
git push git@github2aw:awaragml00029-debug/Clashmerge.git HEAD:main
```

- Docker 镜像：`ghcr.io/awaragml00029-debug/clashmerge:latest`
- 发布前后应确认远端 main 和镜像 digest。

## 验证口径

没有稳定的 `npm test` 测试套件；`npm test` 当前会失败并输出占位信息。优先使用窄范围验证：

- JS 语法检查：

```bash
node --check <changed-file.js>
```

- 转换逻辑验证：用 Node 脚本直接调用 parser/generator，检查结构字段和计数。
- ACL4SSR/Mihomo YAML 输出验证至少检查：
  - 无 `rule-providers`。
  - 无无效规则策略。
  - 无悬空代理组引用。
  - 无不支持的规则类型。
  - `🚀 节点选择` 主组没有 `🚀 手动切换` 和地区组引用。
- Docker 发布前要在构建出的镜像内重复关键转换验证。

## 实现注意事项

- 修改文件前先读相关代码，保持现有命名、注释密度和 CommonJS 风格。
- 后端错误消息保持中文，前端提示也保持中文。
- 新功能优先复用现有 parser/generator；不要复制一套并行转换系统。
- 涉及协议映射时，先确认 Mihomo/Clash 输出格式，再做字段归一化。
- 修改订阅生成逻辑时，同时关注：`routes/conversion.js`、`routes/groups.js`、`services/native/generators/clash.js`、相关 parser。
