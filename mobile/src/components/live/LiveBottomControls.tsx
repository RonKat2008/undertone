import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, FONTS } from '../../theme/tokens';

export interface LiveBottomControlsProps {
  sessionStatus: 'idle' | 'active' | 'ended';
  onStartSession: () => void;
  onStopSession: () => void;
  onAddBookmark: () => void;
  bookmarkCount: number;
  inverted?: boolean;
}

export const LiveBottomControls: React.FC<LiveBottomControlsProps> = ({
  sessionStatus,
  onStartSession,
  onStopSession,
  onAddBookmark,
  bookmarkCount,
  inverted = false,
}) => {
  const [justBookmarked, setJustBookmarked] = useState(false);

  const handleBookmarkPress = () => {
    onAddBookmark();
    setJustBookmarked(true);
    setTimeout(() => setJustBookmarked(false), 1500);
  };

  const isSessionActive = sessionStatus === 'active';

  // Dynamic colors for normal ink vs full-screen pattern takeover
  const bookmarkBg = inverted
    ? 'rgba(0, 0, 0, 0.2)'
    : COLORS.surface;
  const bookmarkBorder = inverted
    ? 'rgba(247, 245, 240, 0.3)'
    : COLORS.hairline;
  const bookmarkTextColor = inverted ? '#F7F5F0' : COLORS.paper;

  return (
    <View style={styles.container}>
      {/* 1. Large Bookmark Button */}
      <TouchableOpacity
        activeOpacity={0.8}
        style={[
          styles.button,
          styles.bookmarkButton,
          { backgroundColor: bookmarkBg, borderColor: bookmarkBorder },
        ]}
        onPress={handleBookmarkPress}
      >
        <Text style={[styles.buttonText, { color: bookmarkTextColor }]}>
          {justBookmarked ? 'Marked' : 'Bookmark Moment'}
        </Text>
        {bookmarkCount > 0 && !justBookmarked && (
          <View style={[styles.badge, { backgroundColor: inverted ? 'rgba(247, 245, 240, 0.25)' : COLORS.hairline }]}>
            <Text style={[styles.badgeText, { color: bookmarkTextColor }]}>
              {bookmarkCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* 2. Large Start / Stop Control */}
      {isSessionActive ? (
        <TouchableOpacity
          activeOpacity={0.8}
          style={[
            styles.button,
            styles.stopButton,
            {
              backgroundColor: inverted ? 'rgba(0, 0, 0, 0.35)' : 'transparent',
              borderColor: inverted ? 'rgba(247, 245, 240, 0.3)' : COLORS.hairline,
            },
          ]}
          onPress={onStopSession}
        >
          <Text style={[styles.buttonText, { color: inverted ? '#F7F5F0' : COLORS.paper }]}>
            Stop Session
          </Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.button, styles.startButton]}
          onPress={onStartSession}
        >
          <Text style={[styles.buttonText, styles.startButtonText]}>
            Start Session
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 12,
    gap: 12,
  },
  button: {
    height: 56,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  bookmarkButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontFamily: FONTS.uiSemiBold,
    fontSize: 16,
    letterSpacing: -0.1,
  },
  badge: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
    borderWidth: 1,
  },
  startButton: {
    backgroundColor: COLORS.paper,
  },
  startButtonText: {
    color: COLORS.ink,
  },
});
