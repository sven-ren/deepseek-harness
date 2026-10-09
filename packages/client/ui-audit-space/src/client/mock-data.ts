/**
 * Stand-in data for the audit-space panel, transcribed from the product
 * prototype. Direction-A verification only: the wide tables and projects are
 * mock rows rendered client-side; the chat zone is the only piece wired to a
 * real agent Session.
 */

/** One wide-table column descriptor. */
export interface WideTableField {
  readonly no: number
  readonly en: string
  readonly cn: string
  readonly type: string
  /** Prototype default: whether the field starts selected. */
  readonly checked: boolean
}

/** One selectable wide table from the prototype's mock set. */
export interface WideTable {
  readonly id: number
  /** Whether this table's data source is authorized for the current audit. */
  readonly auth: boolean
  readonly name: string
  /** Number of companies the table's data scope covers. */
  readonly companies: number
  /** One-line 取数逻辑 preview shown in the row. */
  readonly short: string
  /** Full 取数逻辑 bullets revealed by the hover tooltip. */
  readonly logic: readonly string[]
  readonly fields: readonly WideTableField[]
}

/** The prototype's 7 mock wide tables (3 authorized, 4 not). */
export const WIDE_TABLES: readonly WideTable[] = [
  {
    id: 1, auth: true, name: '经营管理_宽表_经管风险分析资产负债表', companies: 32,
    short: '从未清表中获取开发支出的数据，用上月的最后一天减去同一WBS号最早的记账时间为开发周期；未清余额=截止到上月末的账号余额；账龄未清金额区分：0至6月为上月末往前推6个月……',
    logic: [
      '开发支出：从未清表中获取开发支出的数据，用上月的最后一天减去同一 WBS 号最早的记账时间为开发周期；',
      '未清余额：等于截止到上月末的账号余额；',
      '账龄未清金额区分：0至6月为上月末往前推 6 个月，之间项目的发生额；6-12月、1-2年、2-3年、3年以上等其他账龄区间以此类推；',
      '发生额：取借方金额。',
    ],
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR', checked: true },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR', checked: true },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR', checked: false },
      { no: 4, en: 'sjlx', cn: '时间类型', type: 'VARCHAR', checked: true },
      { no: 5, en: 'sj', cn: '时间', type: 'VARCHAR', checked: false },
      { no: 6, en: 'data_sjc', cn: '业务时间', type: 'String', checked: true },
      { no: 7, en: 'yszkyzdqz', cn: '应收账款原值当期值', type: 'DECIMALV3', checked: true },
      { no: 8, en: 'yszkyzsntqz', cn: '应收账款原值上年同期值', type: 'DECIMALV3', checked: false },
      { no: 9, en: 'yszkztbbdl', cn: '应收账款原值同比变动率', type: 'DECIMALV3', checked: false },
      { no: 10, en: 'dqyysrljz', cn: '当期营业收入累计值', type: 'DECIMALV3', checked: false },
      { no: 11, en: 'sntqyysrljz', cn: '上年同期营业收入累计值', type: 'DECIMALV3', checked: false },
      { no: 12, en: 'yysrljztbbdl', cn: '营业收入累计值同比变动率', type: 'DECIMALV3', checked: false },
      { no: 13, en: 'ysyyszsc', cn: '应收与营收增速差', type: 'DECIMALV3', checked: false },
    ],
  },
  {
    id: 2, auth: true, name: '经营管理_宽表_经管风险分析现金流量表', companies: 28,
    short: '从现金流量表科目发生额中按公司代码、业务时间汇总经营活动／投资活动／筹资活动现金流量净额与期末现金余额……',
    logic: [
      '经营活动现金流量净额：取现金流量表经营类科目借贷方发生额轧差；',
      '投资活动／筹资活动现金流量净额：同理按科目大类汇总；',
      '现金及现金等价物期末余额：取截止到上月末的科目余额；',
      '维度：公司代码 + 业务时间（月度）。',
    ],
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR', checked: true },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR', checked: true },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR', checked: false },
      { no: 4, en: 'sjlx', cn: '时间类型', type: 'VARCHAR', checked: true },
      { no: 5, en: 'sj', cn: '时间', type: 'VARCHAR', checked: false },
      { no: 6, en: 'data_sjc', cn: '业务时间', type: 'String', checked: true },
      { no: 7, en: 'jyxjllje', cn: '经营活动现金流量净额', type: 'DECIMALV3', checked: false },
      { no: 8, en: 'tzxjdllje', cn: '投资活动现金流量净额', type: 'DECIMALV3', checked: false },
      { no: 9, en: 'czxjdllje', cn: '筹资活动现金流量净额', type: 'DECIMALV3', checked: false },
      { no: 10, en: 'xjjeqqm', cn: '现金及现金等价物期末余额', type: 'DECIMALV3', checked: false },
    ],
  },
  {
    id: 3, auth: true, name: '经营管理_宽表_经管风险分析所有者权益变动表', companies: 15,
    short: '按公司代码、业务时间归集所有者权益期初金额、本期增减变动额与期末金额，用于核查权益变动合理性……',
    logic: [
      '期初金额：取上月末所有者权益合计余额；',
      '本期增减变动额：取本期间权益类科目发生额合计；',
      '期末金额：期初 + 本期增减变动额；',
      '维度：公司代码 + 业务时间（月度）。',
    ],
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR', checked: true },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR', checked: true },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR', checked: false },
      { no: 4, en: 'sjlx', cn: '时间类型', type: 'VARCHAR', checked: true },
      { no: 5, en: 'sj', cn: '时间', type: 'VARCHAR', checked: false },
      { no: 6, en: 'data_sjc', cn: '业务时间', type: 'String', checked: false },
      { no: 7, en: 'sgyzqyqchnje', cn: '所有者权益期初金额', type: 'DECIMALV3', checked: false },
      { no: 8, en: 'sgyzqymqje', cn: '所有者权益期末金额', type: 'DECIMALV3', checked: false },
    ],
  },
  {
    id: 4, auth: false, name: '经营管理_宽表_经管风险分析利润表', companies: 9,
    short: '从利润表科目余额中获取当期与累计利润数据，按公司代码与业务时间汇总生成同比指标……',
    logic: [
      '从利润表科目余额中获取当期与累计利润数据；',
      '按公司代码与业务时间维度汇总生成当期值、上年同期值与同比变动率指标。',
    ],
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR', checked: true },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR', checked: true },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR', checked: false },
      { no: 4, en: 'sjlx', cn: '时间类型', type: 'VARCHAR', checked: true },
      { no: 5, en: 'sj', cn: '时间', type: 'VARCHAR', checked: false },
      { no: 6, en: 'data_sjc', cn: '业务时间', type: 'String', checked: false },
      { no: 7, en: 'lr_dqqz', cn: '利润当期值', type: 'DECIMALV3', checked: false },
      { no: 8, en: 'lr_sntqqz', cn: '利润上年同期值', type: 'DECIMALV3', checked: false },
      { no: 9, en: 'lr_tbbdl', cn: '利润同比变动率', type: 'DECIMALV3', checked: false },
    ],
  },
  {
    id: 5, auth: false, name: '经营管理_宽表_应收账款账龄明细表', companies: 12,
    short: '按客户维度统计应收账款余额并按账龄区间（0-6月、6-12月、1-2年……）拆分，输出各区间金额与占比……',
    logic: [
      '按客户代码汇总应收账款期末余额；',
      '按账龄区间（0-6月、6-12月、1-2年、2-3年、3年以上）拆分金额；',
      '计算各账龄区间占应收账款总额比例。',
    ],
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR', checked: true },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR', checked: true },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR', checked: false },
      { no: 4, en: 'data_sjc', cn: '业务时间', type: 'String', checked: true },
      { no: 5, en: 'zlqj', cn: '账龄区间', type: 'VARCHAR', checked: false },
      { no: 6, en: 'yszkje', cn: '应收账款金额', type: 'DECIMALV3', checked: false },
      { no: 7, en: 'yszkbl', cn: '应收账款占比', type: 'DECIMALV3', checked: false },
    ],
  },
  {
    id: 6, auth: false, name: '经营管理_宽表_存货明细表', companies: 6,
    short: '按存货类别归集期末存货金额与跌价准备，计算存货周转天数，用于识别呆滞与减值风险……',
    logic: [
      '按存货类别汇总期末结存金额；',
      '取跌价准备科目余额；',
      '计算存货周转天数 = 平均存货 ÷ 营业成本 × 天数。',
    ],
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR', checked: true },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR', checked: true },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR', checked: false },
      { no: 4, en: 'data_sjc', cn: '业务时间', type: 'String', checked: true },
      { no: 5, en: 'chlb', cn: '存货类别', type: 'VARCHAR', checked: false },
      { no: 6, en: 'chje', cn: '存货金额', type: 'DECIMALV3', checked: false },
      { no: 7, en: 'djzb', cn: '跌价准备', type: 'DECIMALV3', checked: false },
    ],
  },
  {
    id: 7, auth: false, name: '经营管理_宽表_开发支出明细表', companies: 8,
    short: '按 WBS 号归集开发支出发生额与资本化金额，计算开发周期（上月末 - 最早记账时间）……',
    logic: [
      '按 WBS 号汇总开发支出借方发生额；',
      '区分费用化与资本化金额；',
      '开发周期 = 上月的最后一天 - 同一 WBS 号最早的记账时间。',
    ],
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR', checked: true },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR', checked: true },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR', checked: false },
      { no: 4, en: 'wbs_no', cn: 'WBS号', type: 'VARCHAR', checked: false },
      { no: 5, en: 'data_sjc', cn: '业务时间', type: 'String', checked: true },
      { no: 6, en: 'kfzcje', cn: '开发支出金额', type: 'DECIMALV3', checked: false },
      { no: 7, en: 'kfzq', cn: '开发周期（天）', type: 'DECIMALV3', checked: false },
    ],
  },
]

/** One audit project from the prototype's left rail. */
export interface AuditProject {
  readonly name: string
  readonly color: string
}

/** The prototype's 7 mock audit projects. */
export const AUDIT_PROJECTS: readonly AuditProject[] = [
  { name: '港珠澳大桥', color: '#4f7cf0' },
  { name: '京都鸭川项目', color: '#35b884' },
  { name: 'IT绩效审计', color: '#e8703d' },
  { name: '长虹能源2025年度财务收支审计', color: '#8a52e0' },
  { name: '长虹三杰动力锂电池生产线建设项目审计', color: '#2aa9d6' },
  { name: '浙江飞狮离任经济责任审计', color: '#d4494f' },
  { name: '深圳聚和源采购与供应链专项审计', color: '#c9a227' },
]

/** One company tag in the data-scope modal. */
export interface CompanyTag {
  readonly name: string
  readonly code: string
}

/** The prototype's company pool; each wide table shows a prefix of it. */
export const COMPANY_POOL: readonly CompanyTag[] = [
  { name: '集团整体', code: 'ZT' },
  { name: '消费者BG', code: 'BG01' },
  { name: '智慧显示（中国）公司', code: 'BG01-1' },
  { name: '虹魔方', code: 'BG01-1-1' },
  { name: '美菱（国内）', code: 'BG01-2' },
  { name: '中科美菱', code: 'BG01-2-1' },
  { name: '生活电器', code: 'BG01-2-2' },
  { name: '空调（国内）', code: 'BG01-3' },
  { name: '宏源热泵', code: 'BG01-3-1' },
  { name: '商用中央空调', code: 'BG01-3-2' },
  { name: '国际智慧显示事业部（广东长虹）', code: 'BG01-4' },
  { name: '国际冰洗事业部', code: 'BG01-5' },
  { name: '国际空调事业部（中山长虹）', code: 'BG01-6' },
  { name: '国际品牌事业部（长虹国际）', code: 'BG01-7' },
  { name: '欧洲品牌', code: 'BG01-7-1' },
  { name: '印尼品牌', code: 'BG01-7-2' },
  { name: '澳洲品牌', code: 'BG01-7-3' },
  { name: '长虹民生', code: 'BG01-8' },
  { name: '快益点', code: 'BG01-9' },
  { name: '企业BG', code: 'BG02' },
  { name: '模塑', code: 'BG02-1' },
  { name: '技佳', code: 'BG02-2' },
  { name: '器件', code: 'BG02-3' },
  { name: '精密', code: 'BG02-4' },
  { name: '包装', code: 'BG02-5' },
  { name: '华意', code: 'BG02-6' },
  { name: '加西贝拉', code: 'BG02-6-1' },
  { name: '华意荆州', code: 'BG02-6-2' },
  { name: '华意巴塞罗那', code: 'BG02-6-3' },
  { name: '浙江威乐', code: 'BG02-6-4' },
  { name: '晋创', code: 'BG02-7' },
  { name: '民生照明', code: 'BG02-8' },
]

/** One read-only field row in the project-detail modal. */
export interface ProjectDetailField {
  readonly label: string
  readonly required: boolean
  /** Rendered as a `start ~ end` pair when true. */
  readonly range?: boolean
  /** A plain value, or tag chips when `tags` is set. */
  readonly value: string
  readonly tags?: readonly CompanyTag[]
}

/** The prototype's read-only project-detail grid. */
export const PROJECT_DETAIL: readonly ProjectDetailField[] = [
  { label: '项目名称', required: true, value: 'X集团大宗商品铜比价审计' },
  { label: '项目实施期间', required: true, range: true, value: '2026-09-01 ~ 2026-09-30' },
  { label: '项目编号', required: true, value: '虹股审〔2026〕1008号' },
  { label: '被审计单位', required: true, value: '供应链平台' },
  { label: '项目组长', required: true, value: '邱锦' },
  { label: '项目副组长', required: false, value: '—' },
  { label: '项目成员', required: false, value: '', tags: [{ name: '凤星星', code: '' }, { name: '刘娟姆', code: '' }] },
  { label: '数据口径', required: true, value: '', tags: [{ name: '管理口径组织', code: '' }] },
  { label: '实施单位', required: true, value: '集团审计部' },
  {
    label: '数据范围', required: true, value: '',
    tags: [{ name: '模塑', code: 'BG02-1' }, { name: '技佳', code: 'BG02-2' }],
  },
  { label: '审计期间', required: true, range: true, value: '2026-09-02 ~ 2026-09-08' },
]
