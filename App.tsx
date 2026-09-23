import React, { useState, useEffect } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  StatusBar,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import { DramaItem, UserRole } from './src/data/models/Drama';
import { COLORS } from './src/theme/colors';
import { ProtectedVideoPlayer } from './src/components/ProtectedVideoPlayer';
import { calculatePayout, getAdPayload, getCatalog, searchCatalog, submitCreatorContent } from './src/api/client';
import { readSession } from './src/core/security/sessionStorage';

export default function App() {
  const [activeTab, setActiveTab] = useState<'Home' | 'Search' | 'Creator' | 'Ads' | 'Profile'>('Home');
  const [currentScreen, setCurrentScreen] = useState<'Tabs' | 'Details' | 'Player' | 'Payout' | 'Upload' | 'Campaign' | 'Checkout' | 'Support'>('Tabs');
  const [catalog, setCatalog] = useState<DramaItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedDrama, setSelectedDrama] = useState<DramaItem | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<string>('Episode 1: Last Platform');
  const [userRole, setUserRole] = useState<UserRole>('VIEWER');

  // Video Player States
  const [isPlaying, setIsPlaying] = useState(true);
  const [showAd, setShowAd] = useState(true);
  const [adCountdown, setAdCountdown] = useState(5);
  const [watermarkPos] = useState({ top: 35, left: 20 });
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  useEffect(() => {
    readSession().then((session) => {
      if (session) setUserRole(session.role);
    }).catch(() => undefined);
  }, []);

  const loadCatalog = () => {
    setCatalogLoading(true);
    setCatalogError(null);
    getCatalog()
      .then(setCatalog)
      .catch(() => setCatalogError('The catalog is unavailable. Check the API connection and try again.'))
      .finally(() => setCatalogLoading(false));
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  // Ad Skip Countdown Timer
  useEffect(() => {
    if (currentScreen === 'Player' && showAd && adCountdown > 0) {
      const timer = setTimeout(() => setAdCountdown(adCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [currentScreen, showAd, adCountdown]);

  const openDramaDetails = (drama: DramaItem) => {
    setSelectedDrama(drama);
    setCurrentScreen('Details');
  };

  const startPlayback = (drama: DramaItem, epTitle?: string) => {
    setSelectedDrama(drama);
    setSelectedEpisode(epTitle || drama.episodes[0]?.title || drama.title);
    setShowAd(true);
    setAdCountdown(5);
    setIsPlaying(true);
    setPlaybackSpeed(1);
    setCaptionsEnabled(false);
    setCurrentScreen('Player');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        {...(Platform.OS === 'android' ? { backgroundColor: COLORS.bg } : {})}
      />

      {/* ===================== VIEW ROUTING ===================== */}
      {currentScreen === 'Details' && selectedDrama ? (
        /* SCREEN 2: EPISODE DETAILS */
        <View style={{ flex: 1 }}>
          <View style={styles.topHeader}>
            <TouchableOpacity onPress={() => setCurrentScreen('Tabs')}>
              <Text style={styles.backBtnText}>‹ Back to Home</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
            <View style={styles.heroCard}>
              <View style={styles.heroPosterPlaceholder}>
                <View style={styles.vipTag}><Text style={styles.vipTagText}>{selectedDrama.badge}</Text></View>
                <Text style={styles.heroDramaTitle}>{selectedDrama.title}</Text>
                <Text style={styles.heroSub}>{selectedDrama.genre} • {selectedDrama.rating}</Text>
              </View>
            </View>

            <Text style={styles.dramaDescription}>{selectedDrama.description}</Text>

            <TouchableOpacity
              style={styles.cyanPrimaryBtn}
              activeOpacity={0.8}
              onPress={() => startPlayback(selectedDrama, selectedDrama.episodes[0]?.title)}
            >
              <Text style={styles.cyanPrimaryBtnText}>▶ Play Episode</Text>
            </TouchableOpacity>

            <Text style={styles.sectionHeaderTitle}>Episode Details</Text>
            {selectedDrama.episodes.map((ep) => (
              <View key={ep.id} style={styles.episodeCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.episodeTitle}>{ep.title}</Text>
                  <Text style={styles.episodeMeta}>{ep.duration} • {ep.rating}</Text>
                </View>
                <TouchableOpacity
                  style={styles.cyanSmallBtn}
                  onPress={() => startPlayback(selectedDrama, ep.title)}
                >
                  <Text style={styles.cyanSmallBtnText}>Play</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : currentScreen === 'Player' && selectedDrama ? (
        /* SCREEN 3: VIDEO PLAYER WITH DAI AD & FORENSIC WATERMARK */
        <View style={styles.playerContainer}>
          <View style={styles.playerTopBar}>
            <TouchableOpacity onPress={() => setCurrentScreen('Tabs')}>
              <Text style={styles.backBtnText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.playerScreenTitle} numberOfLines={1}>{selectedDrama.title} ({selectedDrama.rating})</Text>
          </View>

          {/* Video Stage / Ad Area */}
          <View style={styles.videoStage}>
            <ProtectedVideoPlayer
              episodeId={selectedDrama.episodes.find((episode) => episode.title === selectedEpisode)?.id || selectedDrama.episodes[0]?.id || selectedDrama.id}
              paused={!isPlaying || showAd}
              role={userRole}
            />
            {/* Dynamic Watermark */}
            <View pointerEvents="none" style={[styles.watermarkContainer, watermarkPos]}>
              <Text style={styles.watermarkText}>FORENSIC WATERMARK</Text>
              <Text style={styles.watermarkText}>UID: 84920 • IP: 175.143.22.8</Text>
            </View>

            {/* DAI Mid-roll Ad Overlay */}
            {showAd ? (
              <View style={styles.adCard}>
                <View style={styles.adHeaderRow}>
                  <View style={styles.daiBadge}>
                    <Text style={styles.daiBadgeText}>DAI AD</Text>
                  </View>
                  <Text style={styles.adRemaining}>0:12 remaining</Text>
                </View>

                <Text style={styles.adTitle}>Clean Energy EV Launch — Q3</Text>

                <View style={styles.adActionRow}>
                  <TouchableOpacity onPress={() => Linking.openURL('https://globalstation.example/ads/ev-launch').catch(() => Alert.alert('Unable to open ad', 'The advertiser link is unavailable right now.'))}>
                    <Text style={styles.learnMoreText}>Learn more ›</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={adCountdown > 0}
                    style={[styles.skipBtn, adCountdown > 0 && { opacity: 0.6 }]}
                    onPress={() => setShowAd(false)}
                  >
                    <Text style={styles.skipBtnText}>
                      {adCountdown > 0 ? `Skip in ${adCountdown}s` : 'Skip Ad ›'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.activeStreamBanner}>
                <Text style={{ color: COLORS.cyan, fontWeight: '700', fontSize: 16 }}>● STREAMING 1080p HLS</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>{selectedEpisode}</Text>
              </View>
            )}
          </View>

          {/* Player Timeline & Controls */}
          <View style={styles.playerControlsArea}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressBar, { width: showAd ? '40%' : '65%' }]} />
            </View>

            <View style={styles.timeRow}>
              <Text style={styles.timeText}>14:20</Text>
              <Text style={styles.midRollNotice}>● Mid-Roll Ad</Text>
              <Text style={styles.timeText}>42:15</Text>
            </View>

            <View style={styles.controlButtonsRow}>
              <TouchableOpacity onPress={() => Alert.alert('Rewind', 'Playback rewound by 10 seconds.')}><Text style={styles.ctrlSubText}>⏮ 10s</Text></TouchableOpacity>
              <TouchableOpacity
                style={styles.playPauseCircle}
                onPress={() => setIsPlaying(!isPlaying)}
              >
                <Text style={styles.playPauseIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Alert.alert('Fast forward', 'Playback advanced by 10 seconds.')}><Text style={styles.ctrlSubText}>10s ⏭</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setCaptionsEnabled(!captionsEnabled)}><Text style={[styles.ctrlSubText, captionsEnabled && { color: COLORS.cyan }]}>CC</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setPlaybackSpeed(playbackSpeed === 2 ? 1 : playbackSpeed + 0.5)}><Text style={styles.ctrlSubText}>{playbackSpeed}×</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      ) : currentScreen === 'Payout' ? (
        <PayoutScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Upload' ? (
        <UploadScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Campaign' ? (
        <CampaignScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Checkout' ? (
        <CheckoutScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : currentScreen === 'Support' ? (
        <SupportScreen onBack={() => setCurrentScreen('Tabs')} />
      ) : (
        /* SCREEN 1, 4, 5, 6: TAB VIEWS */
        <View style={{ flex: 1 }}>
          {activeTab === 'Home' && <HomeTabView dramas={catalog} loading={catalogLoading} error={catalogError} onRetry={loadCatalog} onSelect={openDramaDetails} onPlay={startPlayback} onSearch={() => setActiveTab('Search')} onProfile={() => setActiveTab('Profile')} />}
          {activeTab === 'Search' && <SearchTabView dramas={catalog} loading={catalogLoading} onSelect={openDramaDetails} />}
          {activeTab === 'Creator' && <CreatorTabView onUpload={() => setCurrentScreen('Upload')} onPayout={() => setCurrentScreen('Payout')} />}
          {activeTab === 'Ads' && <AdsTabView onCampaign={() => setCurrentScreen('Campaign')} />}
          {activeTab === 'Profile' && <ProfileTabView onCheckout={() => setCurrentScreen('Checkout')} onSupport={() => setCurrentScreen('Support')} />}
        </View>
      )}

      {/* ===================== BOTTOM NAVIGATION ===================== */}
      <View style={styles.bottomNav}>
        {[
          { key: 'Home', icon: '⌂', label: 'Home' },
          { key: 'Search', icon: '⚲', label: 'Search' },
          { key: 'Creator', icon: '🎬', label: 'Creator' },
          { key: 'Ads', icon: '📊', label: 'Ads' },
          { key: 'Profile', icon: '👤', label: 'Profile' },
        ].map((tab) => {
          const isActive = activeTab === tab.key && currentScreen === 'Tabs';
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.navItem}
              onPress={() => {
                setActiveTab(tab.key as any);
                setCurrentScreen('Tabs');
              }}
            >
              <Text style={[styles.navIcon, isActive && { color: COLORS.cyan }]}>{tab.icon}</Text>
              <Text style={[styles.navLabel, isActive && { color: COLORS.cyan }]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

// --- TAB 1: HOME ---
function HomeTabView({ dramas, loading, error, onRetry, onSelect, onPlay, onSearch, onProfile }: { dramas: DramaItem[]; loading: boolean; error: string | null; onRetry: () => void; onSelect: (d: DramaItem) => void; onPlay: (d: DramaItem) => void; onSearch: () => void; onProfile: () => void }) {
  const [filter, setFilter] = useState('All');
  const [isInMyList, setIsInMyList] = useState(false);
  const visibleDramas = filter === 'All' ? dramas : filter === '⭐ VIP' ? dramas.filter((d) => d.badge === 'VIP') : dramas.filter((d) => d.category === filter);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 90 }}>
      {/* Brand Header */}
      <View style={styles.brandHeader}>
        <Text style={styles.brandTitle}>GLOBAL STATION</Text>
        <View style={styles.headerRightIcons}>
          <TouchableOpacity onPress={onSearch}><Text style={styles.iconTxt}>⚲</Text></TouchableOpacity>
          <TouchableOpacity onPress={onProfile}><Text style={styles.iconTxt}>👤</Text></TouchableOpacity>
        </View>
      </View>

      {/* Genre Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {['All', 'Malay Drama', 'Action', '⭐ VIP'].map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, filter === c && styles.chipActive]}
            onPress={() => setFilter(c)}
          >
            <Text style={[styles.chipText, filter === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading && <Text style={styles.resultsCount}>Loading catalog...</Text>}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={onRetry}><Text style={styles.seeAllText}>Retry</Text></TouchableOpacity>
        </View>
      )}

      {/* Hero Banner */}
      <View style={styles.heroCard}>
        <View style={styles.heroGradient}>
          <View style={styles.vipTag}><Text style={styles.vipTagText}>VIP EXCLUSIVE</Text></View>
          <Text style={styles.heroDramaTitle}>Thorns of the Heart: Season 2</Text>
          <Text style={styles.heroSub}>New Episode • P13 • Romance Drama</Text>

          <View style={styles.heroBtnRow}>
            <TouchableOpacity style={styles.cyanActionBtn} disabled={!dramas[0]} onPress={() => dramas[0] && onPlay(dramas[0])}>
              <Text style={styles.cyanActionBtnText}>▶ Watch Episode 1</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.listActionBtn} onPress={() => setIsInMyList(!isInMyList)}>
              <Text style={styles.listActionBtnText}>{isInMyList ? '✓ In My List' : '+ My List'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Continue Watching Rail */}
      <Text style={styles.sectionHeaderTitle}>Continue Watching</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
        {visibleDramas.filter((d) => d.progress).map((d) => (
          <TouchableOpacity key={d.id} style={styles.continueCard} onPress={() => onSelect(d)}>
            <View style={styles.continuePosterPlaceholder}>
              <Text style={styles.placeholderLabel}>{d.title}</Text>
            </View>
            <View style={styles.progressTrackSmall}>
              <View style={[styles.progressBarSmall, { width: `${(d.progress || 0) * 100}%` }]} />
            </View>
            <View style={styles.cardFooterRow}>
              <Text style={styles.metaSmallText}>{d.timeLeft}</Text>
              <Text style={styles.metaSmallText}>{d.rating}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Popular Dramas Rail */}
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionHeaderTitle}>Popular Dramas</Text>
        <TouchableOpacity onPress={() => setFilter('All')}><Text style={styles.seeAllText}>See all ›</Text></TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railList}>
        {visibleDramas.filter((d) => !d.progress).map((d) => (
          <TouchableOpacity key={d.id} style={styles.popularCard} onPress={() => onSelect(d)}>
            <View style={styles.popularPosterPlaceholder}>
              <View style={d.badge === 'VIP' ? styles.badgeVip : styles.badgeFree}>
                <Text style={styles.badgeText}>{d.badge}</Text>
              </View>
              <Text numberOfLines={2} style={styles.popularCardTitle}>{d.title}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </ScrollView>
  );
}

// --- TAB 2: SEARCH & FILTER ---
function SearchTabView({ dramas, loading, onSelect }: { dramas: DramaItem[]; loading: boolean; onSelect: (d: DramaItem) => void }) {
  const [query, setQuery] = useState('');
  const [selectedPill, setSelectedPill] = useState('All');
  const [results, setResults] = useState<DramaItem[]>(dramas);

  useEffect(() => {
    setResults(dramas);
  }, [dramas]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) return;
      searchCatalog(query).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, loading]);

  const filtered = results.filter((d) =>
    (selectedPill === 'All' ||
      (selectedPill === 'VIP Only' ? d.badge === 'VIP' : d.category.includes(selectedPill)))
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchBarIcon}>⚲</Text>
        <TextInput
          placeholder="Search dramas, films, actors..."
          placeholderTextColor={COLORS.textDim}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
        />
        <Text style={styles.filterIcon}>𝌡</Text>
      </View>

      {/* Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chipRow, { paddingHorizontal: 0 }]}>
        {['All', 'Action', 'Romance', 'VIP Only'].map((pill) => (
          <TouchableOpacity
            key={pill}
            style={[styles.chip, selectedPill === pill && styles.chipActive]}
            onPress={() => setSelectedPill(pill)}
          >
            <Text style={[styles.chipText, selectedPill === pill && styles.chipTextActive]}>{pill}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={[styles.sectionHeaderTitle, { marginTop: 16 }]}>Search & Filter</Text>
      <Text style={styles.resultsCount}>{filtered.length} Results</Text>

      {/* Drama Search Results List */}
      {filtered.map((d) => (
        <TouchableOpacity key={d.id} style={styles.searchResultCard} onPress={() => onSelect(d)}>
          <View style={styles.searchThumbPlaceholder}>
            <Text style={styles.searchThumbLabel}>{d.badge}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.searchResultTitle}>{d.title}</Text>
            <Text style={styles.searchResultMeta}>{d.genre} • {d.rating} {d.tag ? `• ${d.tag}` : ''}</Text>
            <View style={[styles.badgeTagMini, d.badge === 'VIP' ? styles.badgeVip : styles.badgeFree]}>
              <Text style={styles.badgeTextMini}>{d.badge}</Text>
            </View>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// --- TAB 3: CREATOR STUDIO ---
function CreatorTabView({ onUpload, onPayout }: { onUpload: () => void; onPayout: () => void }) {
  const [payout, setPayout] = useState(0);

  useEffect(() => {
    calculatePayout(320000).then((result) => setPayout(result.amount));
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      <View style={styles.creatorHeaderRow}>
        <View>
          <Text style={styles.screenMainTitle}>Creator Studio</Text>
          <Text style={styles.screenSubTitle}>Apex Media Productions</Text>
        </View>
        <TouchableOpacity style={styles.uploadBtn} onPress={onUpload}>
          <Text style={styles.uploadBtnText}>+ Upload Video</Text>
        </TouchableOpacity>
      </View>

      {/* Revenue Card */}
      <View style={styles.metricCard}>
        <Text style={styles.metricCardLabel}>Revenue Share (70/30)</Text>
        <Text style={styles.metricBigAmount}>${payout.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
        <Text style={styles.metricSubInfo}>Global Station 70% | Creator 30% (Net)</Text>
          <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={onPayout}>
          <Text style={styles.cyanPrimaryBtnText}>Request Payout</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionHeaderTitle, { marginTop: 24 }]}>Content Pipeline</Text>

      <View style={styles.pipelineCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pipelineTitle}>Episode 6: The Silent Contract</Text>
          <Text style={styles.pipelineSub}>Submitted 2 hours ago</Text>
        </View>
        <View style={styles.badgeWarning}>
          <Text style={styles.badgeWarningText}>IN REVIEW</Text>
        </View>
      </View>

      <View style={styles.pipelineCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.pipelineTitle}>Episode 5: Shadows in the City</Text>
          <Text style={styles.pipelineSub}>185K Views • 4.1K Hours</Text>
        </View>
        <View style={styles.badgeSuccess}>
          <Text style={styles.badgeSuccessText}>APPROVED</Text>
        </View>
      </View>
    </ScrollView>
  );
}

// --- TAB 4: ADVERTISER HUB ---
function AdsTabView({ onCampaign }: { onCampaign: () => void }) {
  const [adTitle, setAdTitle] = useState('Loading ad payload...');

  useEffect(() => {
    getAdPayload().then((ad) => setAdTitle(ad.title));
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      <View style={styles.creatorHeaderRow}>
        <View>
          <Text style={styles.screenMainTitle}>Advertiser Hub</Text>
          <Text style={styles.screenSubTitle}>Apex Media Productions</Text>
        </View>
        <TouchableOpacity style={styles.uploadBtn} onPress={onCampaign}>
          <Text style={styles.uploadBtnText}>+ New Campaign</Text>
        </TouchableOpacity>
      </View>

      {/* Campaign Card */}
      <View style={styles.campaignCard}>
        <View style={styles.campaignHeaderRow}>
          <Text style={styles.campaignTitle}>{adTitle}</Text>
          <View style={styles.badgeSuccess}>
            <Text style={styles.badgeSuccessText}>ACTIVE</Text>
          </View>
        </View>
        <Text style={styles.campaignSub}>Dynamic Ad Insertion (Mid-Roll)</Text>

        <View style={styles.paramGrid}>
          <View style={styles.paramRow}>
            <Text style={styles.paramLabel}>Geography:</Text>
            <Text style={styles.paramValue}>KL, Selangor, Penang</Text>
          </View>
          <View style={styles.paramRow}>
            <Text style={styles.paramLabel}>Audience:</Text>
            <Text style={styles.paramValue}>Free Viewers</Text>
          </View>
          <View style={styles.paramRow}>
            <Text style={styles.paramLabel}>Budget:</Text>
            <Text style={styles.paramValue}>$12.00 CPM</Text>
          </View>
        </View>

        {/* 3 Metrics */}
        <View style={styles.statColumnsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>850K</Text>
            <Text style={styles.statKey}>Impressions</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>88%</Text>
            <Text style={styles.statKey}>Completion</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>3.4%</Text>
            <Text style={styles.statKey}>CTR</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// --- TAB 5: PROFILE & VIP SUBSCRIPTION ---
function ProfileTabView({ onCheckout, onSupport }: { onCheckout: () => void; onSupport: () => void }) {
  const [selectedPlan, setSelectedPlan] = useState('Annual VIP Plan');
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }}>
      {/* Profile Header */}
      <View style={styles.profileUserRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>A</Text>
        </View>
        <View style={{ marginLeft: 14 }}>
          <Text style={styles.profileName}>Aleeya Rahman</Text>
          <Text style={styles.profileEmail}>VIP Member • aleeya@email.com</Text>
        </View>
      </View>

      <Text style={styles.vipHeaderCentered}>VIP Profile</Text>
      <Text style={styles.vipSubCentered}>Ad-free • 4K quality • All episodes</Text>

      {/* Plan 1: Annual */}
      <TouchableOpacity style={[styles.planCard, selectedPlan === 'Annual VIP Plan' && styles.planCardActive]} onPress={() => { setSelectedPlan('Annual VIP Plan'); onCheckout(); }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planTitle}>Annual VIP Plan</Text>
          <Text style={styles.planBadgeText}>Save 33% ⭐ Most popular</Text>
        </View>
        <Text style={styles.planPrice}>RM 119.90/yr</Text>
      </TouchableOpacity>

      {/* Plan 2: Monthly */}
      <TouchableOpacity style={[styles.planCard, selectedPlan === 'Monthly VIP Plan' && styles.planCardActive]} onPress={() => { setSelectedPlan('Monthly VIP Plan'); onCheckout(); }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planTitle}>Monthly VIP Plan</Text>
          <Text style={styles.planSub}>Cancel anytime</Text>
        </View>
        <Text style={styles.planPrice}>RM 14.90/mo</Text>
      </TouchableOpacity>

      {/* Referral Card */}
      <View style={styles.referralCard}>
        <Text style={styles.referralTitle}>Friend Referral Program</Text>
        <Text style={styles.referralCode}>Share code <Text style={{ color: COLORS.cyan, fontWeight: '700' }}>ALEEYA360</Text></Text>
        <TouchableOpacity style={styles.whatsappBtn} onPress={() => Linking.openURL('whatsapp://send?text=Join%20me%20on%20Global%20Station%20with%20code%20ALEEYA360').catch(() => Alert.alert('WhatsApp unavailable', 'Install WhatsApp to share your referral code.'))}>
          <Text style={styles.whatsappBtnText}>📲 Share to WhatsApp</Text>
        </TouchableOpacity>
      </View>

      {/* Support Card */}
      <View style={styles.supportCard}>
        <Text style={styles.supportHeader}>Support Ticket #1084</Text>
        <Text style={styles.supportSub}>VIP playback assistance • Open</Text>
        <TouchableOpacity style={{ marginTop: 8 }} onPress={onSupport}>
          <Text style={styles.contactSupportLink}>Need help? Contact Support</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function FlowHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return <View style={styles.flowHeader}><TouchableOpacity onPress={onBack}><Text style={styles.backBtnText}>‹ Back</Text></TouchableOpacity><Text style={styles.flowHeaderTitle}>{title}</Text><View style={{ width: 48 }} /></View>;
}

function FlowField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return <View style={styles.flowField}><Text style={styles.flowLabel}>{label}</Text><TextInput value={value} editable={false} multiline={multiline} style={[styles.flowInput, multiline && styles.flowTextArea]} placeholderTextColor={COLORS.textDim} /></View>;
}

function PayoutScreen({ onBack }: { onBack: () => void }) {
  return <View style={styles.flowScreen}><FlowHeader title="Payout Gateway" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Payout Gateway</Text><Text style={styles.screenSubTitle}>Withdraw your creator earnings</Text>
    <View style={styles.flowMetric}><Text style={styles.metricCardLabel}>Available balance</Text><Text style={styles.metricBigAmount}>$3,700.00</Text><Text style={styles.metricSubInfo}>Next payout: 15 Aug 2026</Text></View>
    <FlowField label="Payout method" value="Maybank •••• 2048" /><FlowField label="Payout amount" value="$3,700.00" /><FlowField label="Payout note" value="Monthly creator earnings" />
    <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={() => Alert.alert('Payout requested', 'Your payout is now being processed.')}><Text style={styles.cyanPrimaryBtnText}>Confirm $3,700.00 Payout</Text></TouchableOpacity>
  </ScrollView></View>;
}

function UploadScreen({ onBack }: { onBack: () => void }) {
  return <View style={styles.flowScreen}><FlowHeader title="Upload New Video" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Upload New Video</Text><Text style={styles.screenSubTitle}>Submit an episode for review</Text>
    <FlowField label="Video title" value="Episode 6: The Silent Contract" /><FlowField label="Drama / series" value="Thorns of the Heart: Season 2" /><FlowField label="Episode number" value="6" /><FlowField label="Synopsis" value="A new contract changes everything for the production team." multiline /><FlowField label="Video package" value="1080p HLS • 42:15" />
    <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={() => Alert.alert('Upload submitted', 'Your video is now in review.')}><Text style={styles.cyanPrimaryBtnText}>Submit for Review</Text></TouchableOpacity>
  </ScrollView></View>;
}

function CampaignScreen({ onBack }: { onBack: () => void }) {
  return <View style={styles.flowScreen}><FlowHeader title="Create Ad Campaign" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Create Ad Campaign</Text><Text style={styles.screenSubTitle}>Launch a dynamic mid-roll campaign</Text>
    <FlowField label="Campaign name" value="Clean Energy EV Launch - Q3" /><FlowField label="Target geography" value="KL, Selangor, Penang" /><FlowField label="Audience" value="Free viewers" /><FlowField label="Budget" value="$12.00 CPM" /><FlowField label="Ad creative" value="EV launch 30s video" />
    <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={() => Alert.alert('Campaign created', 'Your campaign is ready for review.')}><Text style={styles.cyanPrimaryBtnText}>Launch Campaign</Text></TouchableOpacity>
  </ScrollView></View>;
}

function CheckoutScreen({ onBack }: { onBack: () => void }) {
  return <View style={styles.flowScreen}><FlowHeader title="VIP Plan Checkout" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>VIP Plan Checkout</Text><Text style={styles.screenSubTitle}>Unlock every episode without ads</Text>
    <View style={styles.flowMetric}><Text style={styles.metricCardLabel}>Annual VIP Plan</Text><Text style={styles.metricBigAmount}>RM 119.90</Text><Text style={styles.metricSubInfo}>Billed yearly • Save 33%</Text></View>
    <FlowField label="Payment method" value="Visa •••• 4242" /><FlowField label="Billing email" value="aleeya@email.com" /><Text style={styles.checkoutTotal}>Total today <Text style={{ color: COLORS.cyan }}>RM 119.90</Text></Text>
    <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={() => Alert.alert('Welcome to VIP', 'Your membership is active.')}><Text style={styles.cyanPrimaryBtnText}>Confirm VIP Payment</Text></TouchableOpacity>
  </ScrollView></View>;
}

function SupportScreen({ onBack }: { onBack: () => void }) {
  return <View style={styles.flowScreen}><FlowHeader title="Customer Support Center" onBack={onBack} /><ScrollView contentContainerStyle={styles.flowContent}>
    <Text style={styles.screenMainTitle}>Customer Support Center</Text><Text style={styles.screenSubTitle}>We usually reply within 10 minutes</Text>
    <View style={styles.supportChat}><Text style={styles.chatAgent}>Global Station Support</Text><Text style={styles.chatMessage}>Hi Aleeya, how can we help with your VIP playback?</Text></View>
    <FlowField label="Issue category" value="VIP playback assistance" /><FlowField label="Message" value="I need help continuing my episode." multiline />
    <TouchableOpacity style={styles.cyanPrimaryBtn} onPress={() => Alert.alert('Ticket sent', 'Support ticket #1084 has been updated.')}><Text style={styles.cyanPrimaryBtnText}>Send Message</Text></TouchableOpacity>
    <TouchableOpacity style={styles.secondaryFlowBtn} onPress={() => Linking.openURL('mailto:support@globalstation.example')}><Text style={styles.secondaryFlowText}>Email support</Text></TouchableOpacity>
  </ScrollView></View>;
}

// --- STYLESHEET ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  flowScreen: { flex: 1, backgroundColor: COLORS.bg },
  flowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderColor: COLORS.cardBorder },
  flowHeaderTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  flowContent: { padding: 16, paddingBottom: 100 },
  flowMetric: { backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 10, padding: 16, marginTop: 16 },
  flowField: { marginTop: 14 },
  flowLabel: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 6 },
  flowInput: { minHeight: 44, backgroundColor: COLORS.cardBg, borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 7, color: '#fff', paddingHorizontal: 12, paddingVertical: 10, fontSize: 12 },
  flowTextArea: { minHeight: 76, textAlignVertical: 'top' },
  checkoutTotal: { color: COLORS.textMuted, fontSize: 13, fontWeight: '800', textAlign: 'right', marginTop: 18 },
  supportChat: { backgroundColor: '#102b3b', borderWidth: 1, borderColor: COLORS.cyanDark, borderRadius: 9, padding: 14, marginTop: 18 },
  chatAgent: { color: COLORS.cyan, fontSize: 11, fontWeight: '800' },
  chatMessage: { color: COLORS.textLight, fontSize: 12, marginTop: 8, lineHeight: 18 },
  secondaryFlowBtn: { alignItems: 'center', paddingVertical: 13, marginTop: 10, borderRadius: 7, borderWidth: 1, borderColor: COLORS.cardBorder },
  secondaryFlowText: { color: COLORS.cyan, fontSize: 12, fontWeight: '800' },
  topHeader: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: COLORS.cardBorder },
  backBtnText: { color: COLORS.cyan, fontSize: 16, fontWeight: '700' },

  brandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  brandTitle: { fontSize: 20, fontWeight: '900', color: COLORS.cyan, letterSpacing: 0.8 },
  headerRightIcons: { flexDirection: 'row', gap: 14 },
  iconTxt: { color: COLORS.textLight, fontSize: 18 },

  chipRow: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  chipActive: { backgroundColor: COLORS.cyan, borderColor: COLORS.cyan },
  chipText: { color: COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#000', fontWeight: '800' },

  heroCard: { marginHorizontal: 16, marginTop: 8, borderRadius: 16, overflow: 'hidden' },
  heroGradient: {
    backgroundColor: '#162e4a',
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  heroPosterPlaceholder: {
    backgroundColor: '#162e4a',
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  vipTag: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.gold,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 8,
  },
  vipTagText: { color: '#000', fontSize: 10, fontWeight: '900' },
  heroDramaTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  heroSub: { color: COLORS.textMuted, fontSize: 13, marginTop: 4 },
  heroBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  cyanActionBtn: {
    backgroundColor: COLORS.cyan,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  cyanActionBtnText: { color: '#000', fontWeight: '800', fontSize: 13 },
  listActionBtn: {
    backgroundColor: COLORS.cardBg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  listActionBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 16,
    marginTop: 16,
  },
  sectionHeaderTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginLeft: 16, marginTop: 14 },
  seeAllText: { color: COLORS.cyan, fontSize: 13, fontWeight: '600' },

  railList: { paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  continueCard: {
    width: 140,
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    overflow: 'hidden',
  },
  continuePosterPlaceholder: {
    height: 75,
    backgroundColor: '#1a283e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  placeholderLabel: { color: COLORS.textMuted, fontSize: 11, textAlign: 'center', fontWeight: '600' },
  progressTrackSmall: { height: 3, backgroundColor: '#0f172a', width: '100%' },
  progressBarSmall: { height: '100%', backgroundColor: COLORS.cyan },
  cardFooterRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 8 },
  metaSmallText: { color: COLORS.textDim, fontSize: 10, fontWeight: '700' },

  popularCard: { width: 125, height: 160, borderRadius: 10, overflow: 'hidden' },
  popularPosterPlaceholder: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 10,
    padding: 8,
    justifyContent: 'space-between',
  },
  popularCardTitle: { color: '#fff', fontSize: 12, fontWeight: '700' },

  badgeVip: { alignSelf: 'flex-start', backgroundColor: COLORS.gold, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  badgeFree: { alignSelf: 'flex-start', backgroundColor: COLORS.green, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  badgeText: { color: '#000', fontSize: 9, fontWeight: '900' },

  // Drama Details View
  dramaDescription: { color: COLORS.textMuted, fontSize: 13, marginTop: 12, lineHeight: 18 },
  cyanPrimaryBtn: {
    backgroundColor: COLORS.cyan,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 14,
  },
  cyanPrimaryBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
  episodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  episodeTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  episodeMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  cyanSmallBtn: {
    backgroundColor: COLORS.cyan,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  cyanSmallBtnText: { color: '#000', fontWeight: '800', fontSize: 12 },

  // Video Player Styles
  playerContainer: { flex: 1, backgroundColor: '#000' },
  playerTopBar: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  playerScreenTitle: { color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 12, flex: 1 },
  videoStage: {
    height: 320,
    backgroundColor: '#050a12',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  watermarkContainer: { position: 'absolute', zIndex: 99, opacity: 0.3 },
  watermarkText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  adCard: {
    width: '90%',
    backgroundColor: '#0d1829',
    borderWidth: 1,
    borderColor: COLORS.gold,
    borderRadius: 10,
    padding: 14,
  },
  adHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  daiBadge: { backgroundColor: COLORS.gold, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  daiBadgeText: { color: '#000', fontSize: 10, fontWeight: '900' },
  adRemaining: { color: COLORS.textMuted, fontSize: 11 },
  adTitle: { color: '#fff', fontSize: 14, fontWeight: '800', marginTop: 8 },
  adActionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  learnMoreText: { color: COLORS.cyan, fontSize: 12, fontWeight: '700' },
  skipBtn: { backgroundColor: '#1e293b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  skipBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  activeStreamBanner: { alignItems: 'center' },
  playerControlsArea: { padding: 16 },
  progressTrack: { height: 4, backgroundColor: '#1e293b', borderRadius: 2 },
  progressBar: { height: '100%', backgroundColor: COLORS.cyan, borderRadius: 2 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  timeText: { color: COLORS.textMuted, fontSize: 11 },
  midRollNotice: { color: COLORS.gold, fontSize: 11, fontWeight: '700' },
  controlButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginTop: 20,
  },
  ctrlSubText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  playPauseCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.cyan,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playPauseIcon: { color: '#000', fontSize: 18, fontWeight: '900' },

  // Search View Styles
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  searchBarIcon: { color: COLORS.textMuted, fontSize: 16 },
  searchInput: { flex: 1, height: 44, color: '#fff', paddingHorizontal: 10 },
  filterIcon: { color: COLORS.textMuted, fontSize: 16 },
  resultsCount: { color: COLORS.cyan, fontSize: 12, fontWeight: '700', marginTop: 2 },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#3f1d25',
    borderColor: '#9f1239',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    margin: 16,
  },
  errorText: { color: '#fecdd3', flex: 1, fontSize: 12, marginRight: 10 },
  searchResultCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.cardBg,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  searchThumbPlaceholder: {
    width: 60,
    height: 60,
    backgroundColor: '#1b293d',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchThumbLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '800' },
  searchResultTitle: { color: '#fff', fontSize: 13, fontWeight: '800' },
  searchResultMeta: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  badgeTagMini: { alignSelf: 'flex-start', marginTop: 6 },
  badgeTextMini: { color: '#000', fontSize: 9, fontWeight: '900' },

  // Creator & Ads Styles
  creatorHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  screenMainTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  screenSubTitle: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  uploadBtn: { backgroundColor: COLORS.cyan, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  uploadBtnText: { color: '#000', fontWeight: '800', fontSize: 12 },
  metricCard: {
    backgroundColor: COLORS.cardBg,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  metricCardLabel: { color: '#fff', fontSize: 14, fontWeight: '800' },
  metricBigAmount: { color: COLORS.cyan, fontSize: 26, fontWeight: '900', marginTop: 6 },
  metricSubInfo: { color: COLORS.textDim, fontSize: 11, marginTop: 4 },
  pipelineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  pipelineTitle: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pipelineSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  badgeWarning: { backgroundColor: '#713f12', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  badgeWarningText: { color: COLORS.gold, fontSize: 10, fontWeight: '800' },
  badgeSuccess: { backgroundColor: '#064e3b', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  badgeSuccessText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },

  campaignCard: {
    backgroundColor: COLORS.cardBg,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  campaignHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  campaignTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  campaignSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  paramGrid: { backgroundColor: '#0d1624', padding: 10, borderRadius: 8, marginTop: 12 },
  paramRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  paramLabel: { color: COLORS.textDim, fontSize: 11 },
  paramValue: { color: '#fff', fontSize: 11, fontWeight: '600' },
  statColumnsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statBox: {
    flex: 1,
    backgroundColor: '#0d1624',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: { color: COLORS.cyan, fontSize: 16, fontWeight: '900' },
  statKey: { color: COLORS.textDim, fontSize: 10, marginTop: 2 },

  // Profile View Styles
  profileUserRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { color: '#000', fontSize: 20, fontWeight: '900' },
  profileName: { color: '#fff', fontSize: 18, fontWeight: '900' },
  profileEmail: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  vipHeaderCentered: { color: '#fff', fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: 10 },
  vipSubCentered: { color: COLORS.textDim, fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 10,
  },
  planCardActive: { borderColor: COLORS.cyan },
  planTitle: { color: '#fff', fontSize: 14, fontWeight: '800' },
  planBadgeText: { color: COLORS.gold, fontSize: 11, fontWeight: '700', marginTop: 2 },
  planPrice: { color: '#fff', fontSize: 14, fontWeight: '900' },
  planSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  referralCard: {
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 16,
  },
  referralTitle: { color: '#fff', fontSize: 13, fontWeight: '800' },
  referralCode: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  whatsappBtn: {
    backgroundColor: COLORS.greenBtn,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  whatsappBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  supportCard: {
    backgroundColor: COLORS.cardBg,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    marginTop: 12,
  },
  supportHeader: { color: '#fff', fontSize: 13, fontWeight: '800' },
  supportSub: { color: COLORS.textDim, fontSize: 11, marginTop: 2 },
  contactSupportLink: { color: COLORS.cyan, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },

  // Bottom Navigation Bar
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: '#0a1220',
    borderTopWidth: 1,
    borderColor: COLORS.cardBorder,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navItem: { alignItems: 'center', justifyContent: 'center' },
  navIcon: { color: COLORS.textDim, fontSize: 16 },
  navLabel: { color: COLORS.textDim, fontSize: 10, fontWeight: '600', marginTop: 2 },
});