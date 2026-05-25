require('./utils/logger');
const express = require("express");
const path = require("path");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const Database = require("./database");
const { checkAuthForAdmin, requireAuth } = require("./middleware/auth");
const { getLocalIPAddresses } = require("./utils/network");
const cache = require("./services/cache");

// 创建路由
const createAuthRoutes = require("./routes/auth");
const createSubscriptionRoutes = require("./routes/subscriptions");
const createGroupRoutes = require("./routes/groups");
const createConfigRoutes = require("./routes/config");
const createConversionRoutes = require("./routes/conversion");

const app = express();
const port = process.env.PORT || 3000;
const db = new Database();
cache.clear();

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/.test(filePath)) {
      res.setHeader("Cache-Control", "no-cache");
    }
  },
}));
app.use(
  "/vendor/ace",
  express.static(path.join(__dirname, "node_modules", "ace-builds", "src-min-noconflict"))
);

// Session 配置 - 使用文件存储实现持久化
app.use(
  session({
    store: new FileStore({
      path: path.join(__dirname, "data", "sessions"),
      ttl: 7 * 24 * 60 * 60, // 7天过期
      reapInterval: 24 * 60 * 60, // 每24小时清理过期session
      logFn: function () { }, // 禁用日志
    }),
    secret: "subx-admin-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // 在生产环境中应该设置为 true（需要HTTPS）
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
    },
  })
);

// 应用身份验证中间件
app.use(checkAuthForAdmin);

// 注册路由
app.use(createAuthRoutes(db, requireAuth));
app.use(createSubscriptionRoutes(db));
app.use(createGroupRoutes(db));
app.use(createConfigRoutes(db));
app.use(createConversionRoutes(db));

// 启动服务器
app.listen(port, "0.0.0.0", () => {
  const addresses = getLocalIPAddresses(port);

  console.log(`服务器运行在:`);
  console.log(`  - http://127.0.0.1:${port}`);
  addresses.forEach(addr => {
    console.log(`  - ${addr}`);
  });
  console.log(`管理页面访问地址:`);
  console.log(`  - http://127.0.0.1:${port}/admin`);
  addresses.forEach(addr => {
    console.log(`  - ${addr}/admin`);
  });
});

// 优雅关闭
// 优雅关闭
process.on("SIGINT", () => {
  console.log("\n正在关闭服务器...");
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n正在关闭服务器...");
  db.close();
  process.exit(0);
});
