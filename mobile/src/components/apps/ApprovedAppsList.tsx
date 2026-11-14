import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, TYPE_SCALE } from '../../theme/tokens';
import { ConnectedApp } from './types';

interface ApprovedAppsListProps {
  apps: ConnectedApp[];
  onRevoke: (id: string) => void;
}

export function ApprovedAppsList({ apps, onRevoke }: ApprovedAppsListProps) {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>AUTHORIZED APPLICATIONS</Text>
        <Text style={styles.countBadge}>{apps.length}</Text>
      </View>

      {apps.length === 0 ? (
        <View style={styles.emptyWell}>
          <Text style={styles.emptyText}>No third-party apps currently authorized.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {apps.map((app, index) => (
            <View
              key={app.id}
              style={[
                styles.appRow,
                index > 0 && styles.itemBorderTop,
              ]}
            >
              <View style={styles.infoCol}>
                <View style={styles.nameRow}>
                  <Text style={styles.appName}>{app.name}</Text>
                  <View style={styles.activeDot} />
                </View>

                {app.permissions ? (
                  <Text style={styles.permissionsText}>{app.permissions}</Text>
                ) : null}

                <View style={styles.metaRow}>
                  <Text style={styles.metaLabel}>LAST USED</Text>
                  <Text style={styles.metaValue}>{app.lastUsed}</Text>
                </View>
              </View>

              <View style={styles.actionCol}>
                <Pressable
                  style={({ pressed }) => [
                    styles.revokeButton,
                    pressed && styles.revokePressed,
                  ]}
                  onPress={() => onRevoke(app.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke access for ${app.name}`}
                >
                  <Text style={styles.revokeButtonText}>Revoke</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
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
  appRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
  },
  itemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  infoCol: {
    flex: 1,
    marginRight: SPACING.md,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    marginBottom: 2,
  },
  appName: {
    fontFamily: FONTS.uiSemiBold,
    fontSize: TYPE_SCALE.md,
    color: COLORS.paper,
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.patterns.success,
  },
  permissionsText: {
    fontFamily: FONTS.ui,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.inkMid,
    marginBottom: SPACING.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  metaLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.other,
    letterSpacing: 0.8,
  },
  metaValue: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.paper,
  },
  actionCol: {
    alignItems: 'flex-end',
  },
  revokeButton: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokePressed: {
    borderColor: COLORS.patterns.interrupt,
    backgroundColor: 'rgba(224, 60, 49, 0.08)',
  },
  revokeButtonText: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.patterns.interrupt,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
