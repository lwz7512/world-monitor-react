/**
 * Central registry of all React panel components.
 *
 * Each entry maps a panel ID (as used in ctx.panelSettings / the DOM) to:
 *  - `load`  — dynamic import of the module containing the component
 *  - `name`  — the named export to extract from that module
 *
 * Used by PanelLayout.tsx (Phase 7) to lazily render panels declaratively.
 *
 * Panels NOT in this registry (handled separately by PanelLayoutManager):
 *  - News-category panels (class-based NewsPanel, dynamic per CANONICAL_FEEDS)
 *  - Custom widget / MCP panels (spec-driven, ids unknown at build time)
 */

export interface ReactPanelEntry {
  // Module importer — the consumer casts `m[name]` to ComponentType.
  load: () => Promise<Record<string, unknown>>;
  name: string;
}

export const PANEL_REGISTRY: Record<string, ReactPanelEntry> = {
  // ── Core / Overview ──────────────────────────────────────────────────────
  heatmap: { load: () => import('@/components/panels/HeatmapPanel'), name: 'HeatmapPanel' },
  monitors: { load: () => import('@/components/panels/MonitorPanel'), name: 'MonitorPanel' },
  'latest-brief': {
    load: () => import('@/components/panels/LatestBriefPanel'),
    name: 'LatestBriefPanel',
  },
  insights: {
    load: () => import('@/components/panels/InsightsPanel'),
    name: 'InsightsPanel',
  },
  'cross-source-signals': {
    load: () => import('@/components/panels/CrossSourceSignalsPanel'),
    name: 'CrossSourceSignalsPanel',
  },
  'gdelt-intel': {
    load: () => import('@/components/panels/GdeltIntelPanel'),
    name: 'GdeltIntelPanel',
  },
  deduction: {
    load: () => import('@/components/panels/DeductionPanel'),
    name: 'DeductionPanel',
  },
  'regional-intelligence': {
    load: () => import('@/components/panels/RegionalIntelligencePanel'),
    name: 'RegionalIntelligencePanel',
  },
  'chat-analyst': {
    load: () => import('@/components/panels/ChatAnalystPanel'),
    name: 'ChatAnalystPanel',
  },
  forecast: {
    load: () => import('@/components/panels/ForecastPanel'),
    name: 'ForecastPanel',
  },
  'world-clock': {
    load: () => import('@/components/panels/WorldClockPanel'),
    name: 'WorldClockPanel',
  },

  // ── Markets & Finance ─────────────────────────────────────────────────────
  markets: { load: () => import('@/components/panels/MarketPanel'), name: 'MarketPanel' },
  'stock-analysis': {
    load: () => import('@/components/panels/StockAnalysisPanel'),
    name: 'StockAnalysisPanel',
  },
  'stock-backtest': {
    load: () => import('@/components/panels/StockBacktestPanel'),
    name: 'StockBacktestPanel',
  },
  commodities: {
    load: () => import('@/components/panels/CommoditiesPanel'),
    name: 'CommoditiesPanel',
  },
  economic: {
    load: () => import('@/components/panels/EconomicPanel'),
    name: 'EconomicPanel',
  },
  'macro-signals': {
    load: () => import('@/components/panels/MacroSignalsPanel'),
    name: 'MacroSignalsPanel',
  },
  'macro-tiles': {
    load: () => import('@/components/panels/MacroTilesPanel'),
    name: 'MacroTilesPanel',
  },
  'fear-greed': {
    load: () => import('@/components/panels/FearGreedPanel'),
    name: 'FearGreedPanel',
  },
  'aaii-sentiment': {
    load: () => import('@/components/panels/AAIISentimentPanel'),
    name: 'AAIISentimentPanel',
  },
  'market-breadth': {
    load: () => import('@/components/panels/MarketBreadthPanel'),
    name: 'MarketBreadthPanel',
  },
  fsi: { load: () => import('@/components/panels/FSIPanel'), name: 'FSIPanel' },
  'yield-curve': {
    load: () => import('@/components/panels/YieldCurvePanel'),
    name: 'YieldCurvePanel',
  },
  'earnings-calendar': {
    load: () => import('@/components/panels/EarningsCalendarPanel'),
    name: 'EarningsCalendarPanel',
  },
  'economic-calendar': {
    load: () => import('@/components/panels/EconomicCalendarPanel'),
    name: 'EconomicCalendarPanel',
  },
  'cot-positioning': {
    load: () => import('@/components/panels/CotPositioningPanel'),
    name: 'CotPositioningPanel',
  },
  'liquidity-shifts': {
    load: () => import('@/components/panels/LiquidityShiftsPanel'),
    name: 'LiquidityShiftsPanel',
  },
  'positioning-247': {
    load: () => import('@/components/panels/PositioningPanel'),
    name: 'PositioningPanel',
  },
  'gold-intelligence': {
    load: () => import('@/components/panels/GoldIntelligencePanel'),
    name: 'GoldIntelligencePanel',
  },
  'etf-flows': {
    load: () => import('@/components/panels/ETFFlowsPanel'),
    name: 'ETFFlowsPanel',
  },
  'national-debt': {
    load: () => import('@/components/panels/NationalDebtPanel'),
    name: 'NationalDebtPanel',
  },
  'daily-market-brief': {
    load: () => import('@/components/panels/DailyMarketBriefPanel'),
    name: 'DailyMarketBriefPanel',
  },
  'market-implications': {
    load: () => import('@/components/panels/MarketImplicationsPanel'),
    name: 'MarketImplicationsPanel',
  },
  'wsb-ticker-scanner': {
    load: () => import('@/components/panels/WsbTickerScannerPanel'),
    name: 'WsbTickerScannerPanel',
  },
  polymarket: {
    load: () => import('@/components/panels/PredictionPanel'),
    name: 'PredictionPanel',
  },

  // ── Crypto ────────────────────────────────────────────────────────────────
  crypto: { load: () => import('@/components/panels/CryptoPanel'), name: 'CryptoPanel' },
  'crypto-heatmap': {
    load: () => import('@/components/panels/CryptoHeatmapPanel'),
    name: 'CryptoHeatmapPanel',
  },
  'defi-tokens': {
    load: () => import('@/components/panels/DefiTokensPanel'),
    name: 'DefiTokensPanel',
  },
  'ai-tokens': {
    load: () => import('@/components/panels/AiTokensPanel'),
    name: 'AiTokensPanel',
  },
  'other-tokens': {
    load: () => import('@/components/panels/OtherTokensPanel'),
    name: 'OtherTokensPanel',
  },
  stablecoins: {
    load: () => import('@/components/panels/StablecoinPanel'),
    name: 'StablecoinPanel',
  },

  // ── Trade & Economics ─────────────────────────────────────────────────────
  'trade-policy': {
    load: () => import('@/components/panels/TradePolicyPanel'),
    name: 'TradePolicyPanel',
  },
  'sanctions-pressure': {
    load: () => import('@/components/panels/SanctionsPressurePanel'),
    name: 'SanctionsPressurePanel',
  },
  'supply-chain': {
    load: () => import('@/components/panels/SupplyChainPanel'),
    name: 'SupplyChainPanel',
  },
  'global-procurement': {
    load: () => import('@/components/panels/GlobalProcurementPanel'),
    name: 'GlobalProcurementPanel',
  },
  'consumer-prices': {
    load: () => import('@/components/panels/ConsumerPricesPanel'),
    name: 'ConsumerPricesPanel',
  },
  'grocery-basket': {
    load: () => import('@/components/panels/GroceryBasketPanel'),
    name: 'GroceryBasketPanel',
  },
  bigmac: { load: () => import('@/components/panels/BigMacPanel'), name: 'BigMacPanel' },
  'fuel-prices': {
    load: () => import('@/components/panels/FuelPricesPanel'),
    name: 'FuelPricesPanel',
  },
  'fao-food-price-index': {
    load: () => import('@/components/panels/FaoFoodPriceIndexPanel'),
    name: 'FaoFoodPriceIndexPanel',
  },

  // ── Energy ────────────────────────────────────────────────────────────────
  'energy-complex': {
    load: () => import('@/components/panels/EnergyComplexPanel'),
    name: 'EnergyComplexPanel',
  },
  'oil-inventories': {
    load: () => import('@/components/panels/OilInventoriesPanel'),
    name: 'OilInventoriesPanel',
  },
  'energy-crisis': {
    load: () => import('@/components/panels/EnergyCrisisPanel'),
    name: 'EnergyCrisisPanel',
  },
  'chokepoint-strip': {
    load: () => import('@/components/panels/ChokepointStripPanel'),
    name: 'ChokepointStripPanel',
  },
  'pipeline-status': {
    load: () => import('@/components/panels/PipelineStatusPanel'),
    name: 'PipelineStatusPanel',
  },
  'storage-facility-map': {
    load: () => import('@/components/panels/StorageFacilityMapPanel'),
    name: 'StorageFacilityPanel',
  },
  'fuel-shortages': {
    load: () => import('@/components/panels/FuelShortagePanel'),
    name: 'FuelShortagesPanel',
  },
  'energy-disruptions': {
    load: () => import('@/components/panels/EnergyDisruptionsPanel'),
    name: 'EnergyDisruptionsPanel',
  },
  'energy-risk-overview': {
    load: () => import('@/components/panels/EnergyRiskOverviewPanel'),
    name: 'EnergyRiskOverviewPanel',
  },
  'hormuz-tracker': {
    load: () => import('@/components/panels/HormuzPanel'),
    name: 'HormuzPanel',
  },
  renewable: {
    load: () => import('@/components/panels/RenewableEnergyPanel'),
    name: 'RenewableEnergyPanel',
  },

  // ── Geopolitics & Security ────────────────────────────────────────────────
  'strategic-risk': {
    load: () => import('@/components/panels/StrategicRiskPanel'),
    name: 'StrategicRiskPanel',
  },
  'strategic-posture': {
    load: () => import('@/components/panels/StrategicPosturePanel'),
    name: 'StrategicPosturePanel',
  },
  'ucdp-events': {
    load: () => import('@/components/panels/UcdpEventsPanel'),
    name: 'UcdpEventsPanel',
  },
  cii: { load: () => import('@/components/panels/CIIPanel'), name: 'CIIPanel' },
  cascade: { load: () => import('@/components/panels/CascadePanel'), name: 'CascadePanel' },
  'satellite-fires': {
    load: () => import('@/components/panels/SatelliteFiresPanel'),
    name: 'SatelliteFiresPanel',
  },
  'defense-patents': {
    load: () => import('@/components/panels/DefensePatentsPanel'),
    name: 'DefensePatentsPanel',
  },
  'security-advisories': {
    load: () => import('@/components/panels/SecurityAdvisoriesPanel'),
    name: 'SecurityAdvisoriesPanel',
  },
  'oref-sirens': {
    load: () => import('@/components/panels/OrefSirensPanel'),
    name: 'OrefSirensPanel',
  },
  'telegram-intel': {
    load: () => import('@/components/panels/TelegramIntelPanel'),
    name: 'TelegramIntelPanel',
  },
  'gcc-investments': {
    load: () => import('@/components/panels/GccInvestmentsPanel'),
    name: 'GccInvestmentsPanel',
  },
  'gulf-economies': {
    load: () => import('@/components/panels/GulfEconomiesPanel'),
    name: 'GulfEconomiesPanel',
  },
  'china-corridors': {
    load: () => import('@/components/panels/ChinaCorridorPanel'),
    name: 'ChinaCorridorPanel',
  },
  'china-activity-nowcast': {
    load: () => import('@/components/panels/ChinaActivityNowcastPanel'),
    name: 'ChinaActivityNowcastPanel',
  },
  displacement: {
    load: () => import('@/components/panels/DisplacementPanel'),
    name: 'DisplacementPanel',
  },

  // Correlation panels — all backed by the same CorrelationPanel component;
  // the component reads its own panel ID from PanelShell / AppContext to know
  // which correlation to display.
  'military-correlation': {
    load: () => import('@/components/panels/CorrelationPanel'),
    name: 'CorrelationPanel',
  },
  'escalation-correlation': {
    load: () => import('@/components/panels/CorrelationPanel'),
    name: 'CorrelationPanel',
  },
  'economic-correlation': {
    load: () => import('@/components/panels/CorrelationPanel'),
    name: 'CorrelationPanel',
  },
  'disaster-correlation': {
    load: () => import('@/components/panels/CorrelationPanel'),
    name: 'CorrelationPanel',
  },

  // ── Climate & Environment ─────────────────────────────────────────────────
  climate: {
    load: () => import('@/components/panels/ClimateAnomalyPanel'),
    name: 'ClimateAnomalyPanel',
  },
  'population-exposure': {
    load: () => import('@/components/panels/PopulationExposurePanel'),
    name: 'PopulationExposurePanel',
  },
  'radiation-watch': {
    load: () => import('@/components/panels/RadiationWatchPanel'),
    name: 'RadiationWatchPanel',
  },
  'thermal-escalation': {
    load: () => import('@/components/panels/ThermalEscalationPanel'),
    name: 'ThermalEscalationPanel',
  },
  'disease-outbreaks': {
    load: () => import('@/components/panels/DiseaseOutbreaksPanel'),
    name: 'DiseaseOutbreaksPanel',
  },
  'climate-news': {
    load: () => import('@/components/panels/ClimateNewsPanel'),
    name: 'ClimateNewsPanel',
  },

  // ── Tech ─────────────────────────────────────────────────────────────────
  'geo-hubs': {
    load: () => import('@/components/panels/GeoHubsPanel'),
    name: 'GeoHubsPanel',
  },
  'tech-hubs': {
    load: () => import('@/components/panels/TechHubsPanel'),
    name: 'TechHubsPanel',
  },
  'ai-regulation': {
    load: () => import('@/components/panels/AiRegulationPanel'),
    name: 'AiRegulationPanel',
  },
  'internet-disruptions': {
    load: () => import('@/components/panels/InternetDisruptionsPanel'),
    name: 'InternetDisruptionsPanel',
  },
  'service-status': {
    load: () => import('@/components/panels/ServiceStatusPanel'),
    name: 'ServiceStatusPanel',
  },
  'tech-readiness': {
    load: () => import('@/components/panels/TechReadinessPanel'),
    name: 'TechReadinessPanel',
  },
  events: {
    load: () => import('@/components/panels/TechEventsPanel'),
    name: 'TechEventsPanel',
  },
  'social-velocity': {
    load: () => import('@/components/panels/SocialVelocityPanel'),
    name: 'SocialVelocityPanel',
  },

  // ── Aviation ──────────────────────────────────────────────────────────────
  // Note: 'airline-intel' also side-loads AviationCommandBar; that side-effect
  // remains in PanelLayoutManager until Phase 7 wires it into AirlineIntelPanel.
  'airline-intel': {
    load: () => import('@/components/panels/AirlineIntelPanel'),
    name: 'AirlineIntelPanel',
  },

  // ── Live News ─────────────────────────────────────────────────────────────
  'live-news': {
    load: () => import('@/components/panels/LiveNewsPanel'),
    name: 'LiveNewsPanel',
  },

  // ── Webcams ───────────────────────────────────────────────────────────────
  'live-webcams': {
    load: () => import('@/components/panels/LiveWebcamsPanel'),
    name: 'LiveWebcamsPanel',
  },
  'windy-webcams': {
    load: () => import('@/components/panels/PinnedWebcamsPanel'),
    name: 'PinnedWebcamsPanel',
  },

  // ── Civic / Giving ────────────────────────────────────────────────────────
  giving: { load: () => import('@/components/panels/GivingPanel'), name: 'GivingPanel' },

  // ── Happy variant ─────────────────────────────────────────────────────────
  'positive-feed': {
    load: () => import('@/components/panels/PositiveNewsFeedPanel'),
    name: 'PositiveNewsFeedPanel',
  },
  counters: {
    load: () => import('@/components/panels/CountersPanel'),
    name: 'CountersPanel',
  },
  progress: {
    load: () => import('@/components/panels/ProgressChartsPanel'),
    name: 'ProgressChartsPanel',
  },
  breakthroughs: {
    load: () => import('@/components/panels/BreakthroughsTickerPanel'),
    name: 'BreakthroughsTickerPanel',
  },
  spotlight: {
    load: () => import('@/components/panels/HeroSpotlightPanel'),
    name: 'HeroSpotlightPanel',
  },
  digest: {
    load: () => import('@/components/panels/GoodThingsDigestPanel'),
    name: 'GoodThingsDigestPanel',
  },
  species: {
    load: () => import('@/components/panels/SpeciesComebackPanel'),
    name: 'SpeciesComebackPanel',
  },

  // ── News panels ───────────────────────────────────────────────────────────────
  'politics':         { load: () => import('@/components/panels/news-panel-wrappers'), name: 'PoliticsPanel' },
  'tech':             { load: () => import('@/components/panels/news-panel-wrappers'), name: 'TechPanel' },
  'finance':          { load: () => import('@/components/panels/news-panel-wrappers'), name: 'FinancePanel' },
  'gov':              { load: () => import('@/components/panels/news-panel-wrappers'), name: 'GovPanel' },
  'intel':            { load: () => import('@/components/panels/news-panel-wrappers'), name: 'IntelPanel' },
  'middleeast':       { load: () => import('@/components/panels/news-panel-wrappers'), name: 'MiddleEastPanel' },
  'layoffs':          { load: () => import('@/components/panels/news-panel-wrappers'), name: 'LayoffsPanel' },
  'ai':               { load: () => import('@/components/panels/news-panel-wrappers'), name: 'AiNewsPanel' },
  'startups':         { load: () => import('@/components/panels/news-panel-wrappers'), name: 'StartupsPanel' },
  'vcblogs':          { load: () => import('@/components/panels/news-panel-wrappers'), name: 'VcBlogsPanel' },
  'regionalStartups': { load: () => import('@/components/panels/news-panel-wrappers'), name: 'RegionalStartupsPanel' },
  'unicorns':         { load: () => import('@/components/panels/news-panel-wrappers'), name: 'UnicornsPanel' },
  'accelerators':     { load: () => import('@/components/panels/news-panel-wrappers'), name: 'AcceleratorsPanel' },
  'funding':          { load: () => import('@/components/panels/news-panel-wrappers'), name: 'FundingPanel' },
  'producthunt':      { load: () => import('@/components/panels/news-panel-wrappers'), name: 'ProductHuntPanel' },
  'security':         { load: () => import('@/components/panels/news-panel-wrappers'), name: 'SecurityPanel' },
  'policy':           { load: () => import('@/components/panels/news-panel-wrappers'), name: 'PolicyPanel' },
  'hardware':         { load: () => import('@/components/panels/news-panel-wrappers'), name: 'HardwarePanel' },
  'cloud':            { load: () => import('@/components/panels/news-panel-wrappers'), name: 'CloudPanel' },
  'dev':              { load: () => import('@/components/panels/news-panel-wrappers'), name: 'DevPanel' },
  'github':           { load: () => import('@/components/panels/news-panel-wrappers'), name: 'GithubPanel' },
  'ipo':              { load: () => import('@/components/panels/news-panel-wrappers'), name: 'IpoPanel' },
  'thinktanks':       { load: () => import('@/components/panels/news-panel-wrappers'), name: 'ThinkTanksPanel' },
  'africa':           { load: () => import('@/components/panels/news-panel-wrappers'), name: 'AfricaPanel' },
  'latam':            { load: () => import('@/components/panels/news-panel-wrappers'), name: 'LatAmPanel' },
  'asia':             { load: () => import('@/components/panels/news-panel-wrappers'), name: 'AsiaPanel' },
  'energy':           { load: () => import('@/components/panels/news-panel-wrappers'), name: 'EnergyNewsPanel' },

  // ── Dev / debug (only registered when IS_DEV) ─────────────────────────────
  'runtime-config': {
    load: () => import('@/components/panels/RuntimeConfigPanel'),
    name: 'RuntimeConfigPanel',
  },
  'threat-timeline': {
    load: () => import('@/components/panels/ThreatTimelinePanel'),
    name: 'ThreatTimelinePanel',
  },
};
