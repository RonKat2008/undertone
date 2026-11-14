import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, TYPE_SCALE } from '../../theme/tokens';
import { PendingApp } from './types';

interface PendingRequestsProps {
  requests: PendingApp[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function PendingRequests({ requests, onApprove, onDismiss }: PendingRequestsProps) {
  if (requests.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>PENDING ACCESS REQUESTS</Text>
          <Text style={styles.countBadge}>0</Text>
        </View>
        <View style={styles.emptyWell}>
          <Text style={styles.emptyText}>No pending authorization requests.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleWithIndicator}>
          <View style={styles.pulseDot} />
          <Text style={styles.sectionTitle}>PENDING ACCESS REQUESTS</Text>
        </View>
        <Text style={styles.countBadgeActive}>{requests.length}</Text>
      </View>

      <View style={styles.list}>
        {requests.map((req, index) => (
          <View
            key={req.id}
            style={[
              styles.requestCard,
              index > 0 && styles.itemBorderTop,
            ]}
          >
            <View style={styles.requestHeader}>
              <View style={styles.nameBlock}>
                <Text style={styles.appName}>{req.name}</Text>
                <Text style={styles.appReason}>
                  {req.reason || 'Requests access to trigger haptic patterns'}
                </Text>
              </View>
              <Text style={styles.timestamp}>{req.requestedAt}</Text>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.dismissButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => onDismiss(req.id)}
                accessibilityRole="button"
                accessibilityLabel={`Dismiss ${req.name} request`}
              >
                <Text style={styles.dismissButtonText}>Dismiss</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.approveButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => onApprove(req.id)}
                accessibilityRole="button"
                accessibilityLabel={`Approve ${req.name} request`}
              >
                <Text style={styles.approveButtonText}>Approve</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    marginBottom: SPACING.md,
  },
  titleWithIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.patterns.wrap_up,
  },
  sectionTitle: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.inkMid,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  countBadge: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.inkMid,
  },
  countBadgeActive: {
    fontFamily: FONTS.monoMedium,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.patterns.wrap_up,
  },
  emptyWell: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  emptyText: {
    fontFamily: FONTS.ui,
    fontSize: TYPE_SCALE.sm,
    color: COLORS.inkMid,
  },
  list: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  requestCard: {
    padding: SPACING.md,
  },
  itemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  nameBlock: {
    flex: 1,
  },
  appName: {
    fontFamily: FONTS.uiSemiBold,
    fontSize: TYPE_SCALE.md,
    color: COLORS.paper,
    marginBottom: SPACING.xs,
  },
  appReason: {
    fontFamily: FONTS.ui,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.inkMid,
    lineHeight: 18,
  },
  timestamp: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.other,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
  dismissButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 84,
  },
  dismissButtonText: {
    fontFamily: FONTS.uiMedium,
    fontSize: TYPE_SCALE.sm,
    color: COLORS.inkMid,
  },
  approveButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.paper,
    borderWidth: 1,
    borderColor: COLORS.paper,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 84,
  },
  approveButtonText: {
    fontFamily: FONTS.uiSemiBold,
    fontSize: TYPE_SCALE.sm,
    color: COLORS.ink,
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
