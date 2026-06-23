// The single registration list for object-decode handlers. Each handler file
// exposes one idempotent `installXxx()` that registers its std/ext object ids
// (no other side effects). `index.ts` iterates this array once at module load —
// stubs FIRST, so the real per-handler ports registered after them take
// precedence. Add a new handler in ONE place here (import + array entry); this
// replaces the former dual import+call lists that had to be kept in sync.

import { installDefaultStubHandlers } from './default-stub.ts';
import { installBank13FloorHandlers } from './bank13-floor.ts';
import { installBank13TunnelHandler } from './bank13-tunnel.ts';
import { installBank13SlopesMiscHandlers } from './bank13-slopes-misc.ts';
import { installFloorEdgeOrWallHandlers } from './bank13-floor-edge-or-wall.ts';
import { installFloorSlope22degHandlers } from './bank13-floor-slope-22deg.ts';
import { installFloorSlope45degHandlers } from './bank13-floor-slope-45deg.ts';
import { installTunnelCeilingSlopeRightHandlers } from './bank13-tunnel-ceiling-slope-right.ts';
import { installCastleWallDiagHandlers } from './bank13-castle-wall-diag.ts';
import { installPostVerticalHandlers } from './bank13-post-vertical.ts';
import { installPostHorizontalHandlers } from './bank13-post-horizontal.ts';
import { installLiftTrack30degHandlers } from './bank13-lift-track-30deg.ts';
import { installLiftTrack45degHandlers } from './bank13-lift-track-45deg.ts';
import { installLiftTrackStaticHandlers } from './bank13-lift-track-static.ts';
import { installCloudBlockHandlers } from './bank13-cloud-block.ts';
import { installWaterOpenHandlers } from './bank13-water-open.ts';
import { installWaterMeetsGroundHandlers } from './bank13-water-meets-ground.ts';
import { installWaterMeetsLandOrRockHandlers } from './bank13-water-meets-land-or-rock.ts';
import { installWaterBridgeHandlers } from './bank13-water-bridge.ts';
import { installWaterLiftHandlers } from './bank13-water-lift.ts';
import { installWaterDecorHandlers } from './bank13-water-decor.ts';
import { installLavaOrStone3dHandlers } from './bank13-lava-or-stone-3d.ts';
import { installJungleFloorHandlers } from './bank13-jungle-floor.ts';
import { installJungleLeftWallHandlers } from './bank13-jungle-left-wall.ts';
import { installJungleRightWallHandlers } from './bank13-jungle-right-wall.ts';
import { installJungleMudFloorHandlers } from './bank13-jungle-mud-floor.ts';
import { installJungleMudWallLrHandlers } from './bank13-jungle-mud-wall-lr.ts';
import { installJungleSlope45degHandlers } from './bank13-jungle-slope-45deg.ts';
import { installJungleTreetopCanopyHandlers } from './bank13-jungle-treetop-canopy.ts';
import { installJungleStakeHandlers } from './bank13-jungle-stake.ts';
import { installJungleStoneHandlers } from './bank13-jungle-stone.ts';
import { installJungleVineThinHandlers } from './bank13-jungle-vine-thin.ts';
import { installJungleWoodHandlers } from './bank13-jungle-wood.ts';
import { installJungleTreeTrunkHandlers } from './bank13-jungle-tree-trunk.ts';
import { installJungleBlockPatternHandlers } from './bank13-jungle-block-pattern.ts';
import { installJungleCattailHandlers } from './bank13-jungle-cattail.ts';
import { installJungleWaterHandlers } from './bank13-jungle-water.ts';
import { installJungleTreeLeavesOnlyHandlers } from './bank13-jungle-tree-leaves-only.ts';
import { installRedPlatformHandlers } from './bank13-red-platform.ts';
import { installStoneLargeHandlers } from './bank13-stone-large.ts';
import { installRedStoneHandlers } from './bank13-red-stone.ts';
import { installGrassSlopeUp60degHoleHandlers } from './bank13-grass-slope-up-60deg-hole.ts';
import { installGrassSlopeDown60degHoleHandlers } from './bank13-grass-slope-down-60deg-hole.ts';
import { installPipeVerticalHandlers } from './bank13-pipe-vertical.ts';
import { installSnowCloudBlockHandlers } from './bank13-snow-cloud-block.ts';
import { installSkiLiftTwoPoleHandlers } from './bank13-ski-lift-two-pole.ts';
import { installSpikePillarHandlers } from './bank13-spike-pillar.ts';
import { installWallHBlockHandlers } from './bank13-wall-h-block.ts';
import { installCastlePillarHandlers } from './bank13-castle-pillar.ts';
import { installCastleWallHandlers } from './bank13-castle-wall.ts';
import { installCastleWallDiagEndHandlers } from './bank13-castle-wall-diag-end.ts';
import { installLavaCastleHandlers } from './bank13-lava-castle.ts';
import { installWallBlockThickBHandlers } from './bank13-wall-block-thick-b.ts';
import { installWallColumnVariableHandlers } from './bank13-wall-column-variable.ts';
import { installBgAutotileBlockHandlers } from './bank13-bg-autotile-block.ts';
import { installBgAutotileDecorLookupHandlers } from './bank13-bg-autotile-decor-lookup.ts';
import { installGraffitiRailHandlers } from './bank13-graffiti-rail.ts';
import { installGraffitiRailDiagonalHandlers } from './bank13-graffiti-rail-diagonal.ts';
import { installCastleWallPlatformHandlers } from './bank13-castle-wall-platform.ts';
import { installCastleWallPlatformSlopeHandlers } from './bank13-castle-wall-platform-slope.ts';
import { installSevenSegmentDecorHandlers } from './bank13-seven-segment-decor.ts';
import { installThickPostOverlayHandlers } from './bank13-thick-post-overlay.ts';
import { installTunnelFloorSlopeRightHandlers } from './bank13-tunnel-floor-slope-right.ts';
import { installTunnelFloorSlopeLeftHandlers } from './bank13-tunnel-floor-slope-left.ts';
import { installTunnelCeilingSlopeLeftHandlers } from './bank13-tunnel-ceiling-slope-left.ts';
import { install2x2RepeatingBlockHandlers } from './bank13-2x2-repeating-block.ts';
import { install3x3StructuralHandlers } from './bank13-3x3-structural.ts';
import { install3widePlatformBarHandlers } from './bank13-3wide-platform-bar.ts';
import { installGoalPlatformHandlers } from './bank13-goal-platform.ts';
import { installGrayCementBlockHandlers } from './bank13-gray-cement-block.ts';
import { installSpikyStakeHandlers } from './bank13-spiky-stake.ts';
import { installRandomDecoration8wayHandlers } from './bank13-random-decoration-8way.ts';
import { installTwistedTreeTrunkHandlers } from './bank13-twisted-tree-trunk.ts';
import { installForestPlantsHandlers } from './bank13-forest-plants.ts';
import { installForestFlowerAboveHandlers } from './bank13-forest-flower-above.ts';
import { installForestFlowerBelowHandlers } from './bank13-forest-flower-below.ts';
import { installTwistedTreeLeavesHandlers } from './bank13-twisted-tree-leaves.ts';
import { installTwistedTreeLeavesWideHandlers } from './bank13-twisted-tree-leaves-wide.ts';
import { installTwistedTreeLeafLeftHandlers } from './bank13-twisted-tree-leaf-left.ts';
import { installTwistedTreeLeafRightHandlers } from './bank13-twisted-tree-leaf-right.ts';
import { installTwistedTreeLeafCenterHandlers } from './bank13-twisted-tree-leaf-center.ts';
import { installTwistedTreeSlantedHandlers } from './bank13-twisted-tree-slanted.ts';
import { installRedStairsHandlers } from './bank13-red-stairs.ts';
import { installSmartFloorJunctionHandlers } from './bank13-smart-floor-junction.ts';
import { installFloorSlopeCurveHandlers } from './bank13-floor-slope-curve.ts';
import { installSlopeDecorationDualHandlers } from './bank13-slope-decoration-dual.ts';
import { installOverhang2rowHandlers } from './bank13-overhang-2row.ts';
import { installDecorationMin2x2Handlers } from './bank13-decoration-min2x2.ts';
import { installSlopeFillSignedHandlers } from './bank13-slope-fill-signed.ts';
import { installWideSlopeSignedHandlers } from './bank13-wide-slope-signed.ts';
import { installSpecialCoinHandlers } from './bank13-special-coin.ts';
import { installSpecialCoinKeepslopeHandlers } from './bank13-special-coin-keepslope.ts';
import { installTunnelCeilingSlopeRightSteepHandlers } from './bank13-tunnel-ceiling-slope-right-steep.ts';
import { installTunnelCeilingSlopeLeftSteepHandlers } from './bank13-tunnel-ceiling-slope-left-steep.ts';
import { installFloorNoDecoTopHandlers } from './bank13-floor-no-deco-top.ts';
import { installFallingRockHandlers } from './bank13-falling-rock.ts';
import { installBooGuyBombRoomHandlers } from './bank13-boo-guy-bomb-room.ts';
import { installTreeHandlers } from './bank13-tree.ts';
import { installDonutLiftGiantHandlers } from './bank13-donut-lift-giant.ts';
import { installSlantedLogGradualHandlers } from './bank13-slanted-log-gradual.ts';
import { installSlantedLogHandlers } from './bank13-slanted-log.ts';
import { installTreecap3wideHandlers } from './bank13-treecap-3wide.ts';
import { installTreecap4wideHandlers } from './bank13-treecap-4wide.ts';
import { installNumberPlatformHandlers } from './bank13-number-platform.ts';
import { installColumn3segmentHandlers } from './bank13-column-3segment.ts';
import { installRockInWaterfallHandlers } from './bank13-rock-in-waterfall.ts';
import { installPlantCaveLargeHandlers } from './bank13-plant-cave-large.ts';
import { installLedgeRandomVariantHandlers } from './bank13-ledge-random-variant.ts';
import { installStationaryRockHandlers } from './bank13-stationary-rock.ts';
import { installDonutLiftHandlers } from './bank13-donut-lift.ts';
import { installRavenPlatformHandlers } from './bank13-raven-platform.ts';
import { installColoredBlockHandlers } from './bank13-colored-block.ts';
import { installBreakableRockHandlers } from './bank13-breakable-rock.ts';
import { installPipeHandlers } from './bank13-pipe.ts';
import { installFence2variantHandlers } from './bank13-fence-2variant.ts';
import { installChompSignOrPipeHandlers } from './bank13-chomp-sign-or-pipe.ts';
import { installWallVerticalPairHandlers } from './bank13-wall-vertical-pair.ts';
import { installWallHorizontalPairHandlers } from './bank13-wall-horizontal-pair.ts';
import { installDecoration2tilePairHandlers } from './bank13-decoration-2tile-pair.ts';
import { installDecorationCornerBlockHandlers } from './bank13-decoration-corner-block.ts';
import { installDecorationTileRemapHandlers } from './bank13-decoration-tile-remap.ts';
import { installDiagonalSewagePipe3rowHandlers } from './bank13-diagonal-sewage-pipe-3row.ts';
import { installDiagonalSewagePipe4rowHandlers } from './bank13-diagonal-sewage-pipe-4row.ts';
import { installDiagonalSewagePipe3rowAltHandlers } from './bank13-diagonal-sewage-pipe-3row-alt.ts';
import { installDiagonalSewagePipe4rowAltHandlers } from './bank13-diagonal-sewage-pipe-4row-alt.ts';
import { installPipeEntranceHandlers } from './bank13-pipe-entrance.ts';
import { installTerrain2variantComplexHandlers } from './bank13-terrain-2variant-complex.ts';
import { installTerrain4variantHeight2Handlers } from './bank13-terrain-4variant-height2.ts';
import { installSewerWaterPoolHandlers } from './bank13-sewer-water-pool.ts';
import { installSlope3variant3tileHandlers } from './bank13-slope-3variant-3tile.ts';
import { installColBase8700Off1Handlers } from './bank13-col-base-8700-off1.ts';
import { installColBase8700Off2Handlers } from './bank13-col-base-8700-off2.ts';
import { installColBase8700Off3Handlers } from './bank13-col-base-8700-off3.ts';
import { installSingleTile870FHandlers } from './bank13-single-tile-870F.ts';
import { installSingleTile870EHandlers } from './bank13-single-tile-870E.ts';
import { install4tileCycle854BHandlers } from './bank13-4tile-cycle-854B.ts';
import { installGrowable4variantHandlers } from './bank13-growable-4variant.ts';
import { installLiftWidthSelectHandlers } from './bank13-lift-width-select.ts';
import { installStarBlockHandlers } from './bank13-star-block.ts';
import { installIceFloorHandlers } from './bank13-ice-floor.ts';
import { installIceFloorEdgeWaterHandlers } from './bank13-ice-floor-edge-water.ts';
import { installRandom8phaseHandlers } from './bank13-random-8phase.ts';
import { installSmallIncWidthHandlers } from './bank13-small-inc-width.ts';
import { installLavaCavePoolHandlers } from './bank13-lava-cave-pool.ts';
import { installLavaFlowDownHandlers } from './bank13-lava-flow-down.ts';
import { installMushroomPlatformHandlers } from './bank13-mushroom-platform.ts';
import { installSnowyPlatformSupportHandlers } from './bank13-snowy-platform-support.ts';
import { installIceFloorEdgeHoleHandlers } from './bank13-ice-floor-edge-hole.ts';
import { installSlopeDownLeftShortHandlers } from './bank13-slope-down-left-short.ts';
import { installSlopeDownLeftHalfHandlers } from './bank13-slope-down-left-half.ts';
import { installSlopeDownRightShortHandlers } from './bank13-slope-down-right-short.ts';
import { installSlopeDownRightHalfHandlers } from './bank13-slope-down-right-half.ts';
import { installStone3dWallHandlers } from './bank13-stone-3d-wall.ts';
import { installStone3dHandlers } from './bank13-stone-3d.ts';
import { installMovingStone3dHandlers } from './bank13-moving-stone-3d.ts';
import { installSpikeHandlers } from './bank13-spike.ts';
import { installDecorationOverlayHandlers } from './bank13-decoration-overlay.ts';
import { installExtSingleTileVariant2Handlers } from './bank12-ext-single-tile-variant-2.ts';
import { installExtSingleTileVariant3Handlers } from './bank12-ext-single-tile-variant-3.ts';
import { installExt8x16BlockHandlers } from './bank12-ext-8x16-block.ts';
import { installExtSingleCellDispatchHandlers } from './bank12-ext-single-cell-dispatch.ts';
import { installExt1x1BlockHandlers } from './bank12-ext-1x1-block.ts';
import { installExtPairDispatchHandlers } from './bank12-ext-pair-dispatch.ts';
import { installExtSlopePairHandlers } from './bank12-ext-slope-pair.ts';
import { installExtStakeSingleHandlers } from './bank12-ext-stake-single.ts';
import { installExtSpecialCoinHandlers } from './bank12-ext-special-coin.ts';
import { installExtGiantStubHandlers } from './bank12-ext-giant-stubs.ts';
import { installExtFinalbossSetpieceHandlers } from './bank12-ext-finalboss-setpiece.ts';
import { installExtDefault0009Handlers } from './bank12-ext-default-00-09.ts';
import { installExtWorld6BoneHandlers } from './bank12-ext-world6-bone.ts';
import { installExtDoubleTeleportHoleHandlers } from './bank12-ext-double-teleport-hole.ts';
import { installExtDoubleTeleportDoorHandlers } from './bank12-ext-double-teleport-door.ts';
import { installExtNullHandlers } from './bank12-ext-null.ts';
import { installExtCastleWallHole2x2Handlers } from './bank12-ext-castle-wall-hole-2x2.ts';
import { installExtMovingWall6x7Handlers } from './bank12-ext-moving-wall-6x7.ts';
import { installExtWallDecalFamilyHandlers } from './bank12-ext-wall-decal-family.ts';
import { installExtRandomQuestionBlockHandlers } from './bank12-ext-random-question-block.ts';
import { installExtBgHomeSetHandlers } from './bank12-ext-bg-home-set.ts';
import { installExtGoalPoleHandlers } from './bank12-ext-goal-pole.ts';
import { installExtTreetopGrassHandlers } from './bank12-ext-treetop-grass.ts';
import { installExtTreeRightGrassHandlers } from './bank12-ext-tree-right-grass.ts';
import { installExtTreeLeftGrassHandlers } from './bank12-ext-tree-left-grass.ts';
import { installExtMouseHoleHandlers } from './bank12-ext-mouse-hole.ts';
import { installExtMidGrass2x2Handlers } from './bank12-ext-mid-grass-2x2.ts';
import { installExtUpwardGrass1x2Handlers } from './bank12-ext-upward-grass-1x2.ts';
import { installExtDownwardGrassSingleHandlers } from './bank12-ext-downward-grass-single.ts';
import { installExtArrowSign2x2OverlayHandlers } from './bank12-ext-arrow-sign-2x2-overlay.ts';
import { installExtSpikeMaceCenterHandlers } from './bank12-ext-spike-mace-center.ts';
import { installExtSpikeMaceRoomHandlers } from './bank12-ext-spike-mace-room.ts';
import { installExtSpikeBallRoomHandlers } from './bank12-ext-spike-ball-room.ts';
import { installExtTreetop3x3PairHandlers } from './bank12-ext-treetop-3x3-pair.ts';
import { installExtTreetop5x3PairHandlers } from './bank12-ext-treetop-5x3-pair.ts';
import { installExtTreeLeft3x2TrioHandlers } from './bank12-ext-tree-left-3x2-trio.ts';
import { installExtTreeRight3x2TrioHandlers } from './bank12-ext-tree-right-3x2-trio.ts';
import { installExtDonutBlockSmallHandlers } from './bank12-ext-donut-block-small.ts';
import { installExtRock4x2Handlers } from './bank12-ext-rock-4x2.ts';
import { installExtRock5x3Handlers } from './bank12-ext-rock-5x3.ts';
import { installExtRock3x2AHandlers } from './bank12-ext-rock-3x2-a.ts';
import { installExtRock3x2BHandlers } from './bank12-ext-rock-3x2-b.ts';
import { installExtRock5x4AHandlers } from './bank12-ext-rock-5x4-a.ts';
import { installExtRock5x4BHandlers } from './bank12-ext-rock-5x4-b.ts';
import { installExtRock4x3Handlers } from './bank12-ext-rock-4x3.ts';
import { installExtRock2x2Handlers } from './bank12-ext-rock-2x2.ts';
import { installExtOldBranchHandlers } from './bank12-ext-old-branch.ts';
import { installExtStalactiteRockPairHandlers } from './bank12-ext-stalactite-rock-pair.ts';
import { installExtGrassShadowSmallHandlers } from './bank12-ext-grass-shadow-small.ts';
import { installExtGrassShadowMidHandlers } from './bank12-ext-grass-shadow-mid.ts';
import { installExtGrassShadowBigHandlers } from './bank12-ext-grass-shadow-big.ts';
import { installExtPipeEntry4dirHandlers } from './bank12-ext-pipe-entry-4dir.ts';
import { installExtPipeShapeFamilyHandlers } from './bank12-ext-pipe-shape-family.ts';
import { installExtPipeLakituCavePairHandlers } from './bank12-ext-pipe-lakitu-cave-pair.ts';
import { installExtLakituHoleHandlers } from './bank12-ext-lakitu-hole.ts';
import { installExtGoalFloorStandHandlers } from './bank12-ext-goal-floor-stand.ts';
import { installExtGoalRoof8x5Handlers } from './bank12-ext-goal-roof-8x5.ts';
import { installExtSkyCloudFamilyHandlers } from './bank12-ext-sky-cloud-family.ts';
import { installExtPipeHole4x4Handlers } from './bank12-ext-pipe-hole-4x4.ts';
import { installExtPipeArrow4dirHandlers } from './bank12-ext-pipe-arrow-4dir.ts';
import { installExtNoEggGrassHandlers } from './bank12-ext-no-egg-grass.ts';
import { installExtLineGuideSmallCornerFamilyHandlers } from './bank12-ext-line-guide-small-corner-family.ts';
import { installExtLineGuideMidCornerFamilyHandlers } from './bank12-ext-line-guide-mid-corner-family.ts';
import { installExtLineGuideLargeCornerFamilyHandlers } from './bank12-ext-line-guide-large-corner-family.ts';
import { installExtLineGuideStopperFamilyHandlers } from './bank12-ext-line-guide-stopper-family.ts';
import { installExtPipeCapPairHandlers } from './bank12-ext-pipe-cap-pair.ts';
import { installExtPipeCornerFamilyHandlers } from './bank12-ext-pipe-corner-family.ts';
import { installExtFlowerBurst2x2Handlers } from './bank12-ext-flower-burst-2x2.ts';
import { installExtXmasTreePairHandlers } from './bank12-ext-xmas-tree-pair.ts';
import { installExtIceRampHandlers } from './bank12-ext-ice-ramp.ts';
import { installExtGravelFamilyHandlers } from './bank12-ext-gravel-family.ts';
import { installExtCrystalClusterFamilyHandlers } from './bank12-ext-crystal-cluster-family.ts';
import { installExtUndergroundLavaRockHandlers } from './bank12-ext-underground-lava-rock.ts';
import { installExtMushroomSmallPairHandlers } from './bank12-ext-mushroom-small-pair.ts';
import { installExtMushroomBigPairHandlers } from './bank12-ext-mushroom-big-pair.ts';
import { installExtMushroomClusterPairHandlers } from './bank12-ext-mushroom-cluster-pair.ts';
import { installExtDandelionFamilyHandlers } from './bank12-ext-dandelion-family.ts';
import { installExtSkySmallGirderStandHandlers } from './bank12-ext-sky-small-girder-stand.ts';
import { installExtSnowyPlatformTipHandlers } from './bank12-ext-snowy-platform-tip.ts';
import { installExtSkyBigBasePairHandlers } from './bank12-ext-sky-big-base-pair.ts';
import { installExtEggBlockHandlers } from './bank12-ext-egg-block.ts';
import { installExtFlowerPatternFamilyHandlers } from './bank12-ext-flower-pattern-family.ts';
import { installExtFlowerBlossomFamilyHandlers } from './bank12-ext-flower-blossom-family.ts';
import { installExtFlowerRockArtFamilyHandlers } from './bank12-ext-flower-rock-art-family.ts';
import { installExtPipe3dKeyHandlers } from './bank12-ext-pipe-3d-key.ts';
import { installExtFbCopyScreenExitHandlers } from './bank12-ext-fb-copy-screen-exit.ts';
import { installExtFcVestigialNoopHandlers } from './bank12-ext-fc-vestigial-noop.ts';
import { installExtFdClearMap16CellHandlers } from './bank12-ext-fd-clear-map16-cell.ts';
import { installExtFeSetScreenPageBit7Handlers } from './bank12-ext-fe-set-screen-page-bit7.ts';
import { installExtFfInitScreenExitClearHandlers } from './bank12-ext-ff-init-screen-exit-clear.ts';

export const HANDLER_INSTALLERS: Array<() => void> = [
  installDefaultStubHandlers,
  installBank13FloorHandlers,
  installBank13TunnelHandler,
  installBank13SlopesMiscHandlers,
  installFloorEdgeOrWallHandlers,
  installFloorSlope22degHandlers,
  installFloorSlope45degHandlers,
  installTunnelCeilingSlopeRightHandlers,
  installCastleWallDiagHandlers,
  installPostVerticalHandlers,
  installPostHorizontalHandlers,
  installLiftTrack30degHandlers,
  installLiftTrack45degHandlers,
  installLiftTrackStaticHandlers,
  installCloudBlockHandlers,
  installWaterOpenHandlers,
  installWaterMeetsGroundHandlers,
  installWaterMeetsLandOrRockHandlers,
  installWaterBridgeHandlers,
  installWaterLiftHandlers,
  installWaterDecorHandlers,
  installLavaOrStone3dHandlers,
  installJungleFloorHandlers,
  installJungleLeftWallHandlers,
  installJungleRightWallHandlers,
  installJungleMudFloorHandlers,
  installJungleMudWallLrHandlers,
  installJungleSlope45degHandlers,
  installJungleTreetopCanopyHandlers,
  installJungleStakeHandlers,
  installJungleStoneHandlers,
  installJungleVineThinHandlers,
  installJungleWoodHandlers,
  installJungleTreeTrunkHandlers,
  installJungleBlockPatternHandlers,
  installJungleCattailHandlers,
  installJungleWaterHandlers,
  installJungleTreeLeavesOnlyHandlers,
  installRedPlatformHandlers,
  installStoneLargeHandlers,
  installRedStoneHandlers,
  installGrassSlopeUp60degHoleHandlers,
  installGrassSlopeDown60degHoleHandlers,
  installPipeVerticalHandlers,
  installSnowCloudBlockHandlers,
  installSkiLiftTwoPoleHandlers,
  installSpikePillarHandlers,
  installWallHBlockHandlers,
  installCastlePillarHandlers,
  installCastleWallHandlers,
  installCastleWallDiagEndHandlers,
  installLavaCastleHandlers,
  installWallBlockThickBHandlers,
  installWallColumnVariableHandlers,
  installBgAutotileBlockHandlers,
  installBgAutotileDecorLookupHandlers,
  installGraffitiRailHandlers,
  installGraffitiRailDiagonalHandlers,
  installCastleWallPlatformHandlers,
  installCastleWallPlatformSlopeHandlers,
  installSevenSegmentDecorHandlers,
  installThickPostOverlayHandlers,
  installTunnelFloorSlopeRightHandlers,
  installTunnelFloorSlopeLeftHandlers,
  installTunnelCeilingSlopeLeftHandlers,
  install2x2RepeatingBlockHandlers,
  install3x3StructuralHandlers,
  install3widePlatformBarHandlers,
  installGoalPlatformHandlers,
  installGrayCementBlockHandlers,
  installSpikyStakeHandlers,
  installRandomDecoration8wayHandlers,
  installTwistedTreeTrunkHandlers,
  installForestPlantsHandlers,
  installForestFlowerAboveHandlers,
  installForestFlowerBelowHandlers,
  installTwistedTreeLeavesHandlers,
  installTwistedTreeLeavesWideHandlers,
  installTwistedTreeLeafLeftHandlers,
  installTwistedTreeLeafRightHandlers,
  installTwistedTreeLeafCenterHandlers,
  installTwistedTreeSlantedHandlers,
  installRedStairsHandlers,
  installSmartFloorJunctionHandlers,
  installFloorSlopeCurveHandlers,
  installSlopeDecorationDualHandlers,
  installOverhang2rowHandlers,
  installDecorationMin2x2Handlers,
  installSlopeFillSignedHandlers,
  installWideSlopeSignedHandlers,
  installSpecialCoinHandlers,
  installSpecialCoinKeepslopeHandlers,
  installTunnelCeilingSlopeRightSteepHandlers,
  installTunnelCeilingSlopeLeftSteepHandlers,
  installFloorNoDecoTopHandlers,
  installFallingRockHandlers,
  installBooGuyBombRoomHandlers,
  installTreeHandlers,
  installDonutLiftGiantHandlers,
  installSlantedLogGradualHandlers,
  installSlantedLogHandlers,
  installTreecap3wideHandlers,
  installTreecap4wideHandlers,
  installNumberPlatformHandlers,
  installColumn3segmentHandlers,
  installRockInWaterfallHandlers,
  installPlantCaveLargeHandlers,
  installLedgeRandomVariantHandlers,
  installStationaryRockHandlers,
  installDonutLiftHandlers,
  installRavenPlatformHandlers,
  installColoredBlockHandlers,
  installBreakableRockHandlers,
  installPipeHandlers,
  installFence2variantHandlers,
  installChompSignOrPipeHandlers,
  installWallVerticalPairHandlers,
  installWallHorizontalPairHandlers,
  installDecoration2tilePairHandlers,
  installDecorationCornerBlockHandlers,
  installDecorationTileRemapHandlers,
  installDiagonalSewagePipe3rowHandlers,
  installDiagonalSewagePipe4rowHandlers,
  installDiagonalSewagePipe3rowAltHandlers,
  installDiagonalSewagePipe4rowAltHandlers,
  installPipeEntranceHandlers,
  installTerrain2variantComplexHandlers,
  installTerrain4variantHeight2Handlers,
  installSewerWaterPoolHandlers,
  installSlope3variant3tileHandlers,
  installColBase8700Off1Handlers,
  installColBase8700Off2Handlers,
  installColBase8700Off3Handlers,
  installSingleTile870FHandlers,
  installSingleTile870EHandlers,
  install4tileCycle854BHandlers,
  installGrowable4variantHandlers,
  installLiftWidthSelectHandlers,
  installStarBlockHandlers,
  installIceFloorHandlers,
  installIceFloorEdgeWaterHandlers,
  installRandom8phaseHandlers,
  installSmallIncWidthHandlers,
  installLavaCavePoolHandlers,
  installLavaFlowDownHandlers,
  installMushroomPlatformHandlers,
  installSnowyPlatformSupportHandlers,
  installIceFloorEdgeHoleHandlers,
  installSlopeDownLeftShortHandlers,
  installSlopeDownLeftHalfHandlers,
  installSlopeDownRightShortHandlers,
  installSlopeDownRightHalfHandlers,
  installStone3dWallHandlers,
  installStone3dHandlers,
  installMovingStone3dHandlers,
  installSpikeHandlers,
  installDecorationOverlayHandlers,
  // --- Extended-object handlers — batch 1 (0x00-0x17). Registered after the
  // stubs so they take precedence. default_00_09 (0x00-0x09) lands separately. ---
  installExtSingleTileVariant2Handlers,
  installExtSingleTileVariant3Handlers,
  installExt8x16BlockHandlers,
  installExtSingleCellDispatchHandlers,
  installExt1x1BlockHandlers,
  installExtPairDispatchHandlers,
  installExtSlopePairHandlers,
  installExtStakeSingleHandlers,
  installExtSpecialCoinHandlers,
  installExtGiantStubHandlers,
  installExtFinalbossSetpieceHandlers,
  // --- batch 2 (0x00-0x09 default + 0x1B-0x48) ---
  installExtDefault0009Handlers,
  installExtWorld6BoneHandlers,
  installExtDoubleTeleportHoleHandlers,
  installExtDoubleTeleportDoorHandlers,
  installExtNullHandlers,
  installExtCastleWallHole2x2Handlers,
  installExtMovingWall6x7Handlers,
  installExtWallDecalFamilyHandlers,
  installExtRandomQuestionBlockHandlers,
  installExtBgHomeSetHandlers,
  installExtGoalPoleHandlers,
  // --- batch 3 (ext 0x49-0x62, + 0xA8) ---
  installExtTreetopGrassHandlers,
  installExtTreeRightGrassHandlers,
  installExtTreeLeftGrassHandlers,
  installExtMouseHoleHandlers,
  installExtMidGrass2x2Handlers,
  installExtUpwardGrass1x2Handlers,
  installExtDownwardGrassSingleHandlers,
  installExtArrowSign2x2OverlayHandlers,
  installExtSpikeMaceCenterHandlers,
  installExtSpikeMaceRoomHandlers,
  installExtSpikeBallRoomHandlers,
  installExtTreetop3x3PairHandlers,
  installExtTreetop5x3PairHandlers,
  installExtTreeLeft3x2TrioHandlers,
  installExtTreeRight3x2TrioHandlers,
  installExtDonutBlockSmallHandlers,
  installExtRock4x2Handlers,
  installExtRock5x3Handlers,
  installExtRock3x2AHandlers,
  installExtRock3x2BHandlers,

  // --- batch 4 (0x63-0x91) ---
  installExtRock5x4AHandlers,
  installExtRock5x4BHandlers,
  installExtRock4x3Handlers,
  installExtRock2x2Handlers,
  installExtOldBranchHandlers,
  installExtStalactiteRockPairHandlers,
  installExtGrassShadowSmallHandlers,
  installExtGrassShadowMidHandlers,
  installExtGrassShadowBigHandlers,
  installExtPipeEntry4dirHandlers,
  installExtPipeShapeFamilyHandlers,
  installExtPipeLakituCavePairHandlers,
  installExtLakituHoleHandlers,
  installExtGoalFloorStandHandlers,
  installExtGoalRoof8x5Handlers,
  installExtSkyCloudFamilyHandlers,
  installExtPipeHole4x4Handlers,
  installExtPipeArrow4dirHandlers,
  installExtNoEggGrassHandlers,
  installExtLineGuideSmallCornerFamilyHandlers,

  // --- batch 5 (0x92-0xC9) ---
  installExtLineGuideMidCornerFamilyHandlers,
  installExtLineGuideLargeCornerFamilyHandlers,
  installExtLineGuideStopperFamilyHandlers,
  installExtPipeCapPairHandlers,
  installExtPipeCornerFamilyHandlers,
  installExtFlowerBurst2x2Handlers,
  installExtXmasTreePairHandlers,
  installExtIceRampHandlers,
  installExtGravelFamilyHandlers,
  installExtCrystalClusterFamilyHandlers,
  installExtUndergroundLavaRockHandlers,
  installExtMushroomSmallPairHandlers,
  installExtMushroomBigPairHandlers,
  installExtMushroomClusterPairHandlers,
  installExtDandelionFamilyHandlers,
  installExtSkySmallGirderStandHandlers,
  installExtSnowyPlatformTipHandlers,
  installExtSkyBigBasePairHandlers,
  installExtEggBlockHandlers,
  installExtFlowerPatternFamilyHandlers,

  // --- batch 6 (0xCA-0xFF) ---
  installExtFlowerBlossomFamilyHandlers,
  installExtFlowerRockArtFamilyHandlers,
  installExtPipe3dKeyHandlers,
  installExtFbCopyScreenExitHandlers,
  installExtFcVestigialNoopHandlers,
  installExtFdClearMap16CellHandlers,
  installExtFeSetScreenPageBit7Handlers,
  installExtFfInitScreenExitClearHandlers,
];
