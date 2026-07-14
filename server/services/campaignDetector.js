/**
 * campaignDetector.js — PayGuard Intelligence Layer
 * Runs periodically to detect coordinated attack campaigns from grouped fraud alerts.
 */

const FraudAlert = require('../models/FraudAlert');
const Transaction = require('../models/Transaction');
const Campaign = require('../models/Campaign');
const { eventBus, EVENTS } = require('../events/eventBus');

const CAMPAIGN_WINDOW_MS = 60 * 60 * 1000; // 1 hour look-back window
const MIN_ALERTS_FOR_CAMPAIGN = 3;

// No longer takes `io` — campaign events flow through the central event bus
// (see events/socketBridge.js) instead of every caller having to thread a
// socket instance through. Callers now just: detectCampaigns().
const detectCampaigns = async () => {
  try {
    const since = new Date(Date.now() - CAMPAIGN_WINDOW_MS);

    const recentAlerts = await FraudAlert.find({
      createdAt: { $gte: since },
      status: 'open'
    }).populate('transaction');

    if (recentAlerts.length < MIN_ALERTS_FOR_CAMPAIGN) return;

    const campaigns = [];

    // CAMPAIGN TYPE 1: Device Fingerprint Campaign
    const deviceGroups = groupBy(recentAlerts, a => a.transaction?.deviceId);
    for (const [deviceId, alerts] of Object.entries(deviceGroups)) {
      if (!deviceId || deviceId === 'unknown') continue;
      const uniqueUsers = new Set(alerts.map(a => a.userId));
      if (uniqueUsers.size >= 2 && alerts.length >= MIN_ALERTS_FOR_CAMPAIGN) {
        campaigns.push({
          type: 'DEVICE_FINGERPRINT',
          severity: alerts.length >= 8 ? 'CRITICAL' : 'HIGH',
          title: `Shared Device Attack`,
          description: `Device ${deviceId} used across ${uniqueUsers.size} different user accounts in ${Math.round(CAMPAIGN_WINDOW_MS / 60000)} minutes. Consistent with device sharing in a fraud ring or stolen device being used for account takeover.`,
          affectedUsers: [...uniqueUsers],
          alertIds: alerts.map(a => a._id),
          alertCount: alerts.length,
          totalAmount: alerts.reduce((sum, a) => sum + (a.transaction?.amount || 0), 0),
          commonAttribute: { key: 'deviceId', value: deviceId },
          detectedAt: new Date(),
          status: 'active'
        });
      }
    }

    // CAMPAIGN TYPE 2: Merchant Cluster Attack
    const merchantGroups = groupBy(recentAlerts, a => a.transaction?.merchantId);
    for (const [merchantId, alerts] of Object.entries(merchantGroups)) {
      if (!merchantId) continue;
      const uniqueUsers = new Set(alerts.map(a => a.userId));
      if (uniqueUsers.size >= 3 && alerts.length >= MIN_ALERTS_FOR_CAMPAIGN) {
        const avgScore = alerts.reduce((s, a) => s + a.fraudScore, 0) / alerts.length;
        campaigns.push({
          type: 'MERCHANT_CLUSTER',
          severity: avgScore > 70 ? 'CRITICAL' : 'HIGH',
          title: `Scam Merchant Network`,
          description: `Merchant ${merchantId} has triggered fraud alerts for ${uniqueUsers.size} different users. This matches the profile of a compromised POS terminal, insider fraud, or scam merchant network. Visa's 2025 Threats Report identified 1,000+ merchants in similar schemes across EU and North America.`,
          affectedUsers: [...uniqueUsers],
          alertIds: alerts.map(a => a._id),
          alertCount: alerts.length,
          totalAmount: alerts.reduce((sum, a) => sum + (a.transaction?.amount || 0), 0),
          commonAttribute: { key: 'merchantId', value: merchantId },
          detectedAt: new Date(),
          status: 'active'
        });
      }
    }

    // CAMPAIGN TYPE 3: Enumeration Attack Campaign
    const enumerationAlerts = recentAlerts.filter(a =>
      a.rulesTriggered?.some(r => r.ruleName === 'ENUMERATION_ATTACK_RULE')
    );
    if (enumerationAlerts.length >= MIN_ALERTS_FOR_CAMPAIGN) {
      const uniqueUsers = new Set(enumerationAlerts.map(a => a.userId));
      const uniqueMerchants = new Set(enumerationAlerts.map(a => a.transaction?.merchantId));
      campaigns.push({
        type: 'ENUMERATION_CAMPAIGN',
        severity: 'CRITICAL',
        title: `Coordinated Card Enumeration Attack`,
        description: `${enumerationAlerts.length} enumeration attacks detected across ${uniqueUsers.size} user accounts and ${uniqueMerchants.size} merchants. This is a systematic card-probing operation — automated bots testing card validity with micro-transactions under ₹50 to stay below traditional velocity limits.`,
        affectedUsers: [...uniqueUsers],
        alertIds: enumerationAlerts.map(a => a._id),
        alertCount: enumerationAlerts.length,
        totalAmount: enumerationAlerts.reduce((sum, a) => sum + (a.transaction?.amount || 0), 0),
        commonAttribute: { key: 'rule', value: 'ENUMERATION_ATTACK_RULE' },
        detectedAt: new Date(),
        status: 'active'
      });
    }

    // CAMPAIGN TYPE 4: Geographic Anomaly Cluster (Relay Fraud)
    const geoAlerts = recentAlerts.filter(a =>
      a.rulesTriggered?.some(r => r.ruleName === 'GEOGRAPHIC_ANOMALY_RULE')
    );
    if (geoAlerts.length >= MIN_ALERTS_FOR_CAMPAIGN) {
      const uniqueUsers = new Set(geoAlerts.map(a => a.userId));
      campaigns.push({
        type: 'RELAY_FRAUD',
        severity: 'CRITICAL',
        title: `NFC Relay Fraud Pattern Detected`,
        description: `${geoAlerts.length} geographic anomaly alerts across ${uniqueUsers.size} accounts — transactions appearing simultaneously from geographically distant locations. This matches the NFC Relay Fraud pattern described in Visa's Spring 2025 Threats Report.`,
        affectedUsers: [...uniqueUsers],
        alertIds: geoAlerts.map(a => a._id),
        alertCount: geoAlerts.length,
        totalAmount: geoAlerts.reduce((sum, a) => sum + (a.transaction?.amount || 0), 0),
        commonAttribute: { key: 'rule', value: 'GEOGRAPHIC_ANOMALY_RULE' },
        detectedAt: new Date(),
        status: 'active'
      });
    }

    // CAMPAIGN TYPE 5: Velocity Burst (Account Takeover Wave)
    const velocityAlerts = recentAlerts.filter(a =>
      a.rulesTriggered?.some(r => r.ruleName === 'VELOCITY_RULE')
    );
    if (velocityAlerts.length >= 5) {
      const uniqueUsers = new Set(velocityAlerts.map(a => a.userId));
      if (uniqueUsers.size >= 3) {
        campaigns.push({
          type: 'ACCOUNT_TAKEOVER_WAVE',
          severity: velocityAlerts.length > 10 ? 'CRITICAL' : 'HIGH',
          title: `Account Takeover Wave`,
          description: `${uniqueUsers.size} accounts showing simultaneous velocity bursts. Coordinated account takeover where attackers rapidly drain multiple compromised accounts in parallel before victims notice.`,
          affectedUsers: [...uniqueUsers],
          alertIds: velocityAlerts.map(a => a._id),
          alertCount: velocityAlerts.length,
          totalAmount: velocityAlerts.reduce((sum, a) => sum + (a.transaction?.amount || 0), 0),
          commonAttribute: { key: 'rule', value: 'VELOCITY_RULE' },
          detectedAt: new Date(),
          status: 'active'
        });
      }
    }

    // Persist campaigns to DB and emit to dashboard
    for (const campaignData of campaigns) {
      const existing = await Campaign.findOne({
        type: campaignData.type,
        'commonAttribute.value': campaignData.commonAttribute.value,
        status: 'active',
        detectedAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) }
      });

      if (existing) {
        await Campaign.findByIdAndUpdate(existing._id, {
          alertCount: campaignData.alertCount,
          affectedUsers: campaignData.affectedUsers,
          alertIds: campaignData.alertIds,
          totalAmount: campaignData.totalAmount,
          severity: campaignData.severity
        });
        eventBus.emit(EVENTS.CAMPAIGN_UPDATED, { ...campaignData, _id: existing._id });
      } else {
        const saved = await Campaign.create(campaignData);
        eventBus.emit(EVENTS.CAMPAIGN_NEW, saved);
      }
    }

  } catch (err) {
    console.error('Campaign detection error:', err.message);
  }
};

const groupBy = (arr, keyFn) => {
  return arr.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
};

module.exports = { detectCampaigns };
