# StochasLab · 随机信号分析交互式仿真工作台

面向《随机信号分析》本科课程的纯客户端交互式仿真工具。四个教学模块覆盖随机信号基础、随机过程、线性系统响应与窄带过程；全部数值计算（蒙特卡洛生成、FFT、自相关、数字滤波、希尔伯特变换）均在浏览器内完成，无后端依赖。

- 技术栈：React 18 + TypeScript + Tailwind CSS + Canvas 2D + KaTeX
- 构建产物：纯静态文件（`dist/`），可直接部署到 Cloudflare（`wrangler.jsonc` 已声明静态资源目录）
- 视觉规范：工程白底 + 发丝边框 + 单色强调，符合 bitcoin.org / RFC 文档式排版
- 作者：Molirain · [GitHub](https://github.com/molirain) · [博客](https://blog.molirain.com) · [contact@molirain.com](mailto:contact@molirain.com)

## 本地运行

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建（先做类型检查）
npm run preview  # 预览构建产物
npm run check    # 数值自检（分布、FFT、希尔伯特、滤波器、谱估计）
```

## 部署到 Cloudflare

项目根目录的 `wrangler.jsonc` 已把 `dist` 声明为静态资源目录（`assets.directory`），因此不管是 Pages 还是 Workers 构建，wrangler 都不会再尝试按框架自动识别，也就不会因 Vite 5 版本被拒绝。

### 方式一：Cloudflare Pages（推荐）

| 配置项 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| 框架预设 | None（不要选 Vite，否则 Pages 会尝试自动适配） |
| Node 版本 | 18 或以上 |

### 方式二：Workers 静态资源（`npx wrangler deploy`）

构建日志里出现 `Executing user deploy command: npx wrangler deploy` 时，说明该项目的部署方式是 Workers 而非 Pages。此时必须存在 `wrangler.jsonc`，否则 wrangler 4 会进入框架自动配置流程并报：

```text
✘ [ERROR] The version of Vite used in the project ("5.4.21") cannot be automatically configured.
  Please update the Vite version to at least "6.0.0" and try again.
```

当前 `wrangler.jsonc` 内容：

```jsonc
{
  "name": "random-signal",
  "compatibility_date": "2025-01-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

部署命令：

```bash
npm run build
npx wrangler deploy
```

本地可用 `npx wrangler deploy --dry-run` 验证配置，能读到 `dist` 中的文件即表示不再触发框架自动识别。

## 四个模块

### 模块一 · 随机信号基础
- 高斯 / 均匀 / 指数分布发生器，经验 PDF 直方图与理论密度、ECDF 与理论 CDF 双图对照
- 中心极限定理：动态调整叠加个数 $K$ 与样本数 $M$，观测 $Y_K = \frac{1}{\sqrt{K}}\sum (X_i-\mu)/\sigma$，并用多 $K$ 重复抽样给出偏度 $\propto K^{-1/2}$、超额峰度 $\propto K^{-1}$ 的收敛轨迹
- 非线性映射：半波整流 / 平方律 / 全波整流的密度变换，含零点概率原子的可视化

### 模块二 · 随机过程与随机序列
- 随机相位正弦 $X(t)=A\cos(\omega_0t+\Theta)+N(t)$ 与 AR(1) 高斯-马尔可夫过程
- 集合切片均值 vs 单条轨道时间均值，实时判定遍历性；可注入随机直流分量构造"平稳但非遍历"的反例
- 自相关估计（有偏 / 无偏切换）与周期图 / Welch 功率谱，双向验证维纳-辛钦定理

### 模块三 · 线性系统响应
- 巴特沃斯低通（按 $Q_k=1/(2\cos\theta_k)$ 精确定阶）、一阶 RC（冲激不变法）、FIR 滑动平均、带通
- 输入白噪声 / 有色噪声，输出 $S_Y=|H|^2S_X$ 与等效噪声带宽 $B_N$；对数 / 线性双坐标
- 时域方差与频域积分两条独立路径校验输出功率守恒

### 模块四 · 窄带随机过程
- 带通白噪声经频域希尔伯特变换得到解析信号，解调复包络 $X_c, X_s$
- 包络 $V(t)$ 的瑞利（$A=0$）与莱斯（$A>0$）分布连续过渡，莱斯因子 $K=A^2/(2\sigma^2)$
- 相平面样本云、相位分布、窄带谱与包络相关

## 数值与约定

- 全部实现于浏览器主线程：mulberry32 伪随机数、Box–Muller 正态变换、radix-2 迭代 FFT、频域希尔伯特变换、RBJ 双二阶滤波器、Welch 平均周期图
- 频率单位为 Hz；功率谱为**单边**密度（幅值²/Hz）
- 自相关默认有偏估计 $1/N$，模块二可切换为 $1/(N-|m|)$
- 每个统计量都与闭式理论值并列显示，并给出相对误差；零理论值处改用绝对偏差或 $\sigma$ 单位判定，避免相对误差失真
- `npm run check` 覆盖：贝塞尔函数与莱斯/瑞利分布归一化、自相关 FFT 与直接求和一致性、希尔伯特包的解析验证、二阶节滤波器输出方差与 $\frac{2}{f_s}\int|H|^2df$ 一致性、周期图 Parseval 关系、Welch 峰值与解析期望一致性

## 目录结构

```text
index.html
wrangler.jsonc         Cloudflare 静态资源部署配置
src/
  App.tsx               模块壳体、导航与页脚
  main.tsx              React 入口
  styles.css            Tailwind 基础层与控件样式
  components/
    ui.tsx              面板、滑块、开关、统计表、Canvas 封装
    panels.tsx          公式卡、诊断面板、推导提示、三栏工作台
  lib/
    rng.ts              确定性伪随机数与分布抽样
    math.ts             分布函数、矩、直方图、ECDF、莱斯/瑞利密度
    dsp.ts              FFT、自相关、功率谱、双二阶滤波器、希尔伯特变换
    plot.ts             Canvas 2D 绘图引擎（发丝网格与精确刻度）
  modules/
    module1.tsx         随机信号基础
    module2.tsx         随机过程与随机序列
    module3.tsx         线性系统响应
    module4.tsx         窄带随机过程
scripts/
  selfcheck.ts          数值自检脚本
```

## 参考

- A. Papoulis, S. U. Pillai, *Probability, Random Variables and Stochastic Processes*
- J. G. Proakis, M. Salehi, *Digital Communications*, Ch. 5
- RBJ Audio EQ Cookbook（双二阶滤波器系数）
- Peter Acklam 正态分位数有理逼近（Q-Q 图）