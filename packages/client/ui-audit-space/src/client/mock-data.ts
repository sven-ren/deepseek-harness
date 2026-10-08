/**
 * Stand-in data for the audit-space panel, transcribed from the product
 * prototype. Direction-A verification only: the wide tables and projects are
 * mock rows rendered client-side; the chat zone is the only piece wired to a
 * real agent Session.
 */

/** One selectable wide table from the prototype's mock set. */
export interface WideTable {
  readonly id: number
  /** Whether this table's data source is authorized for the current audit. */
  readonly auth: boolean
  readonly name: string
  /** Number of companies the table's data scope covers. */
  readonly companies: number
  readonly short: string
  readonly fields: readonly WideTableField[]
}

/** One wide-table column descriptor. */
export interface WideTableField {
  readonly no: number
  readonly en: string
  readonly cn: string
  readonly type: string
}

/** The prototype's 7 mock wide tables (3 authorized, 4 not). */
export const WIDE_TABLES: readonly WideTable[] = [
  {
    id: 1, auth: true, name: '经营管理_宽表_经管风险分析资产负债表', companies: 32,
    short: '从未清表中获取开发支出的数据，用上月的最后一天减去同一 WBS 号最早的记账时间为开发周期；未清余额=截止到上月末的账号余额；账龄未清金额区分：0至6月为上月末往前推6个月……',
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR' },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR' },
      { no: 3, en: 'co_nm', cn: '公司名称', type: 'VARCHAR' },
      { no: 4, en: 'sjlx', cn: '时间类型', type: 'VARCHAR' },
      { no: 5, en: 'data_sjc', cn: '业务时间', type: 'String' },
      { no: 6, en: 'yszkyzdqz', cn: '应收账款原值当期值', type: 'DECIMALV3' },
      { no: 7, en: 'yysrljztbbdl', cn: '营业收入累计值同比变动率', type: 'DECIMALV3' },
    ],
  },
  {
    id: 2, auth: true, name: '经营管理_宽表_经管风险分析现金流量表', companies: 28,
    short: '从现金流量表科目发生额中按公司代码、业务时间汇总经营活动／投资活动／筹资活动现金流量净额与期末现金余额……',
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR' },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR' },
      { no: 3, en: 'data_sjc', cn: '业务时间', type: 'String' },
      { no: 4, en: 'jyxjllje', cn: '经营活动现金流量净额', type: 'DECIMALV3' },
      { no: 5, en: 'tzxjdllje', cn: '投资活动现金流量净额', type: 'DECIMALV3' },
      { no: 6, en: 'czxjdllje', cn: '筹资活动现金流量净额', type: 'DECIMALV3' },
      { no: 7, en: 'xjjeqqm', cn: '现金及现金等价物期末余额', type: 'DECIMALV3' },
    ],
  },
  {
    id: 3, auth: true, name: '经营管理_宽表_经管风险分析所有者权益变动表', companies: 15,
    short: '按公司代码、业务时间归集所有者权益期初金额、本期增减变动额与期末金额，用于核查权益变动合理性……',
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR' },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR' },
      { no: 3, en: 'data_sjc', cn: '业务时间', type: 'String' },
      { no: 4, en: 'sgyzqyqchnje', cn: '所有者权益期初金额', type: 'DECIMALV3' },
      { no: 5, en: 'sgyzqymqje', cn: '所有者权益期末金额', type: 'DECIMALV3' },
    ],
  },
  {
    id: 4, auth: false, name: '经营管理_宽表_经管风险分析利润表', companies: 9,
    short: '从利润表科目余额中获取当期与累计利润数据，按公司代码与业务时间汇总生成同比指标……',
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR' },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR' },
      { no: 3, en: 'data_sjc', cn: '业务时间', type: 'String' },
      { no: 4, en: 'lr_dqqz', cn: '利润当期值', type: 'DECIMALV3' },
      { no: 5, en: 'lr_tbbdl', cn: '利润同比变动率', type: 'DECIMALV3' },
    ],
  },
  {
    id: 5, auth: false, name: '经营管理_宽表_应收账款账龄明细表', companies: 12,
    short: '按客户维度统计应收账款余额并按账龄区间（0-6月、6-12月、1-2年……）拆分，输出各区间金额与占比……',
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR' },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR' },
      { no: 3, en: 'data_sjc', cn: '业务时间', type: 'String' },
      { no: 4, en: 'zlqj', cn: '账龄区间', type: 'VARCHAR' },
      { no: 5, en: 'yszkje', cn: '应收账款金额', type: 'DECIMALV3' },
    ],
  },
  {
    id: 6, auth: false, name: '经营管理_宽表_存货明细表', companies: 6,
    short: '按存货类别归集期末存货金额与跌价准备，计算存货周转天数，用于识别呆滞与减值风险……',
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR' },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR' },
      { no: 3, en: 'data_sjc', cn: '业务时间', type: 'String' },
      { no: 4, en: 'chlb', cn: '存货类别', type: 'VARCHAR' },
      { no: 5, en: 'chje', cn: '存货金额', type: 'DECIMALV3' },
    ],
  },
  {
    id: 7, auth: false, name: '经营管理_宽表_开发支出明细表', companies: 8,
    short: '按 WBS 号归集开发支出发生额与资本化金额，计算开发周期（上月末 - 最早记账时间）……',
    fields: [
      { no: 1, en: 'id', cn: 'id', type: 'VARCHAR' },
      { no: 2, en: 'co_cd', cn: '公司代码', type: 'VARCHAR' },
      { no: 3, en: 'data_sjc', cn: '业务时间', type: 'String' },
      { no: 4, en: 'wbs_no', cn: 'WBS号', type: 'VARCHAR' },
      { no: 5, en: 'kfzcje', cn: '开发支出金额', type: 'DECIMALV3' },
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
