# Tracktion Engine — Module Inventory

Repository: https://github.com/Tracktion/tracktion_engine
Version: 3.2.0
HEAD at time of clone: `2877b621` — "Avoided a crash on shutdown" (2026-02-18)
Header count under `modules/`: 636

This is the ground-truth inventory for diagram 2 and a sanity check for
everything downstream. Each directory under `modules/` gets one line:
what lives there, in my words, not marketing's.

## Top-level layout

```
tracktion_engine/
├── CMakeLists.txt, CMakePresets.json, cmake/  CMake build
├── BREAKING-CHANGES.md, CHANGELIST.md, VERSION.md
├── docs/                Handwritten docs (markdown + doxygen config)
├── doxygen/             Doxygen site generator config
├── examples/            JUCE apps that drive the engine (PlaybackDemo, EngineInPluginDemo, …)
├── tutorials/           Code walkthroughs paired with `docs/`
├── tests/               Top-level test entry points (module tests live next to their source)
└── modules/             Everything below is here. This is the engine.
```

## `modules/` — the four pillars

```
modules/
├── 3rd_party/           Vendored dependencies (see below)
├── juce/                JUCE submodule — the cross-platform framework underneath everything
├── tracktion_core/      Foundation types + utilities, no DAW concepts
├── tracktion_graph/     Generic realtime DAG processor, DAW-agnostic
└── tracktion_engine/    The DAW itself: model, playback, plugins, MIDI, audio files
```

Layering direction: `tracktion_engine` depends on `tracktion_graph` depends
on `tracktion_core` depends on JUCE + 3rd_party. Diagram 2 will prove this
from the JUCE module declarations; this inventory just states the intent.

## `modules/3rd_party/` — vendored dependencies

```
choc/           David Rowland's C++ helpers — containers, text, JSON, DSP primitives
crill/          Realtime-safe synchronization primitives (seqlock, progressive backoff)
doctest/        Single-header unit test framework (tests live beside source as *.test.cpp)
expected/       std::expected polyfill for error-return without exceptions
libsamplerate/  Secret Rabbit Code — sample-rate conversion
magic_enum/     Static reflection for enums
nanorange/      Subset of C++20 ranges, usable on older toolchains
rigtorp/        SPSC queue + other lock-free primitives
rpmalloc/       General-purpose allocator; used to get predictable allocation behavior
```

Threading/real-time notes: `crill`, `rigtorp`, and `rpmalloc` are the
real-time-safety toolkit. They feature in diagram 9 and are load-bearing
for "why can't the audio thread allocate."

## `modules/tracktion_core/` — foundation

```
tracktion_core.h, tracktion_core.cpp      Module entry (JUCE-module preamble)
tracktion_TestConfig.h                    Test-only toggles

audio/
  tracktion_AudioReader.h                 Abstract audio reader interface
  tracktion_Types.h                       Channel-set + buffer aliases used everywhere

threads/
  tracktion_MultipleWriterSeqLock.h       Multi-writer seqlock — cross-thread reads of mutable state

utilities/
  tracktion_Tempo.h                       Tempo/beat/bar math, independent of any Edit
  tracktion_Time.h, tracktion_TimeRange.h Strongly-typed time (seconds, beats, samples) + ranges
  tracktion_Bezier.h, tracktion_Maths.h   Math primitives
  tracktion_CPU.h, tracktion_Sanitizers.h Platform / sanitizer helpers
  tracktion_Hash.h                        Stable hashing used for IDs / caches
  tracktion_Benchmark.h                   Microbenchmark scaffolding
  tracktion_AlgorithmAdapters.h           Range-like wrappers for JUCE containers
```

No DAW concepts here. `Edit`, `Track`, `Clip` do not exist in `tracktion_core`.

## `modules/tracktion_graph/` — realtime DAG processor

```
tracktion_graph.h                         Module entry
docs/                                     Graph-module design notes
3rd_party/                                Additional graph-local deps (moodycamel, farbot — verify in diagram 4)

tracktion_graph/
  tracktion_Node.h                        The Node abstract base — every graph vertex
  tracktion_NodePlayer.h                  Single-threaded reference player
  tracktion_MultiThreadedNodePlayer.{h,cpp}
  tracktion_LockFreeMultiThreadedNodePlayer.{h,cpp}   The production player; lock-free scheduling
  tracktion_NodePlayerThreadPools.{h,cpp} Worker pools that run graph nodes
  tracktion_PlayHead.{h,cpp}              PlayHead lives HERE, not in the engine — DAW-agnostic
  tracktion_PlayHeadState.{h,cpp}
  tracktion_Utility.{h,cpp}               Graph-local helpers
  tracktion_TestNodes.h, tracktion_TestUtilities.{h,cpp}
  nodes/
    tracktion_ConnectedNode.h             Generic connectable node
    tracktion_LatencyNode.h               Latency-compensation delay
    tracktion_SummingNode.h               Sum N inputs → 1 output
  players/
    tracktion_SimpleNodePlayer.h          Trivial player for tests/examples
    tracktion_NodePlayerUtilities.h

utilities/                                Graph-scoped utilities
```

Note: `PlayHead` lives in `tracktion_graph`, not `tracktion_engine`. That
is deliberate and is a lesson for diagram 5.

## `modules/tracktion_engine/` — the DAW

```
tracktion_engine.h                        Module entry (public API surface)
3rd_party/                                Engine-local vendored deps

model/                                    The document object model
  edit/                                   `Edit` — the full document (see diagram 3)
    tracktion_Edit.{h,cpp}                The root. Owns everything.
    tracktion_EditFileOperations.{h,cpp}  Load/save an Edit as XML/ValueTree
    tracktion_EditLoader.{h,cpp}          Async load
    tracktion_EditSnapshot.{h,cpp}        Read-only snapshot for UI/offline render
    tracktion_TempoSequence.{h,cpp}       Tempo changes over time
    tracktion_TempoSetting.{h,cpp}
    tracktion_TimeSigSetting.{h,cpp}
    tracktion_PitchSequence.{h,cpp}       Pitch changes over time
    tracktion_PitchSetting.{h,cpp}
    tracktion_MarkerManager.{h,cpp}       Markers (loop points, cue points)
    tracktion_Scene.{h,cpp}               Ableton-style scene row for the launcher
    tracktion_GrooveTemplate.{h,cpp}      Groove quantization templates
    tracktion_QuantisationType.{h,cpp}
    tracktion_LaunchQuantisation.{h,cpp}
    tracktion_EditInsertPoint.{h,cpp}     Where a newly-inserted clip goes
    tracktion_EditItem.{h,cpp}            Base class for anything that has an EditItemID
    tracktion_EditUtilities.{h,cpp}
    tracktion_OldEditConversion.h         Version migration
    tracktion_SourceFileReference.{h,cpp}
    tracktion_TimecodeDisplayFormat.{h,cpp}

  tracks/                                 Track types
    tracktion_Track.{h,cpp}               Track abstract base
    tracktion_AudioTrack.{h,cpp}          Audio tracks with plugins + clips
    tracktion_ClipTrack.{h,cpp}           Base for tracks that hold clips
    tracktion_FolderTrack.{h,cpp}         Grouping track
    tracktion_MasterTrack.{h,cpp}         Master bus
    tracktion_AutomationTrack.{h,cpp}     Automation-only track
    tracktion_ArrangerTrack.{h,cpp}       Session-arrangement track
    tracktion_MarkerTrack.{h,cpp}         Hosts markers
    tracktion_ChordTrack.{h,cpp}          Hosts chord clips
    tracktion_TempoTrack.{h,cpp}          Tempo view (proxy, not owner)
    tracktion_ClipSlot.{h,cpp}            Launcher clip slot
    tracktion_TrackCompManager.{h,cpp}    Comping (takes → single pass)
    tracktion_TrackOutput.{h,cpp}         Track routing / output selection
    tracktion_TrackItem.{h,cpp}, tracktion_TrackUtils.{h,cpp}
    tracktion_EditTime.{h,cpp}            Beats-or-seconds discriminated union

  clips/                                  Clip types
    tracktion_Clip.{h,cpp}                Clip abstract base
    tracktion_ClipOwner.{h,cpp}           Anything that can own clips (Track, Scene, Container)
    tracktion_AudioClipBase.{h,cpp}       Shared audio-clip behavior
    tracktion_WaveAudioClip.{h,cpp}       Plain audio clip
    tracktion_MidiClip.{h,cpp}            MIDI clip
    tracktion_StepClip.{h,cpp}            Drum-machine-style step clip
    tracktion_ChordClip.{h,cpp}           Chord info, drives other clips
    tracktion_ArrangerClip.{h,cpp}        Arrangement clip for the arranger track
    tracktion_MarkerClip.{h,cpp}          A marker rendered as a clip
    tracktion_EditClip.{h,cpp}            An Edit nested inside another Edit
    tracktion_ContainerClip.{h,cpp}       Clip that contains sub-clips
    tracktion_CollectionClip.{h,cpp}      Group of clips treated as one
    tracktion_ClipEffects.{h,cpp}         Per-clip effects chain
    tracktion_CompManager.{h,cpp}         Comping engine (takes + comp passes)
    tracktion_LaunchHandle.{h,cpp}        Launcher start/stop handle
    tracktion_LauncherClipPlaybackHandle.{h,cpp}
    tracktion_FollowActions.{h,cpp}       Post-playback behaviours (loop / stop / next)
    tracktion_WarpTimeManager.{h,cpp}     Per-clip timestretching markers
    tracktion_AudioSegmentList.{h,cpp}    Segmented clip playback for warped audio
    tracktion_EditClipRenderJob.{h,cpp}   Render a nested Edit to audio
    tracktion_ReverseRenderJob.h, tracktion_WarpTimeRenderJob.h

  automation/                             Parameters + automation + modifiers
    tracktion_AutomatableEditItem.{h,cpp}       Mixin for "I can be automated"
    tracktion_AutomatableParameter.{h,cpp}      One parameter exposed to automation
    tracktion_AutomatableParameterTree.h        Hierarchical parameter tree
    tracktion_AutomationCurve.{h,cpp}           The curve data for one parameter
    tracktion_AutomationCurveList.{h,cpp}       Collection of curves per item
    tracktion_AutomationMode.{h,cpp}            Read / write / latch / touch
    tracktion_AutomationRecordManager.{h,cpp}   Live automation recording
    tracktion_Modifier.{h,cpp}                  Modifier base class
    tracktion_MacroParameter.{h,cpp}            One-knob-controls-many param
    tracktion_MidiLearn.{h,cpp}                 MIDI → parameter binding
    tracktion_ParameterChangeHandler.{h,cpp}    Change coalescing/dispatch
    tracktion_ParameterControlMappings.{h,cpp}  Control-surface bindings
    modifiers/
      tracktion_LFOModifier.{h,cpp}
      tracktion_BreakpointOscillatorModifier.{h,cpp}
      tracktion_EnvelopeFollowerModifier.{h,cpp}
      tracktion_MIDITrackerModifier.{h,cpp}
      tracktion_RandomModifier.{h,cpp}
      tracktion_StepModifier.{h,cpp}
      tracktion_ModifierCommon.{h,cpp}

  export/                                 Rendering the model to audio files
    tracktion_Renderer.{h,cpp}            The offline Renderer
    tracktion_RenderOptions.{h,cpp}
    tracktion_RenderManager.{h,cpp}       Job scheduler for renders
    tracktion_ExportJob.{h,cpp}
    tracktion_Exportable.{h,cpp}          Mixin for anything that can be exported
    tracktion_ReferencedMaterialList.h
    tracktion_ArchiveFile.{h,cpp}         Project-archive file format

playback/                                 Transport + device management + graph building
  tracktion_TransportControl.{h,cpp}      Play / stop / record / loop
  tracktion_EditPlaybackContext.{h,cpp}   Per-Edit runtime playback state
  tracktion_EditInputDevices.{h,cpp}      Which device records into which track
  tracktion_DeviceManager.{h,cpp}         Audio + MIDI device lifecycle
  tracktion_HostedAudioDevice.{h,cpp}     When the engine is hosted in a plugin
  tracktion_AbletonLink.{h,cpp}           Ableton Link sync
  tracktion_MidiNoteDispatcher.{h,cpp}    MIDI fan-out on the audio thread
  tracktion_LevelMeasurer.{h,cpp}         dB metering
  tracktion_ScopedSteadyLoad.h            Mark audio-thread work for profiling
  tracktion_MPEStartTrimmer.h             MPE note-start trimming

  devices/                                Concrete input/output device wrappers
    tracktion_InputDevice, tracktion_OutputDevice (bases)
    tracktion_WaveInputDevice, tracktion_WaveOutputDevice
    tracktion_MidiInputDevice, tracktion_MidiOutputDevice
    tracktion_PhysicalMidiInputDevice, tracktion_VirtualMidiInputDevice
    tracktion_WaveDeviceDescription

  graph/                                  ENGINE-SIDE graph nodes (the bridge to tracktion_graph)
    tracktion_EditNodeBuilder.{h,cpp}     Builds a graph from an Edit (diagram 4 starts here)
    tracktion_NodeRenderContext.{h,cpp}   Render-time context passed through the graph
    tracktion_TracktionEngineNode.{h,cpp} Engine-aware Node base
    tracktion_TracktionNodePlayer.h
    tracktion_WaveNode.{h,cpp}            Plays an audio file
    tracktion_TimeStretchingWaveNode.{h,cpp}
    tracktion_SpeedRampWaveNode.{h,cpp}
    tracktion_MidiNode.{h,cpp}            Plays a MIDI sequence
    tracktion_LoopingMidiNode.{h,cpp}
    tracktion_PluginNode.{h,cpp}          Wraps a plugin into a graph node
    tracktion_ModifierNode.{h,cpp}        Wraps a modifier
    tracktion_RackNode.{h,cpp}            Rack → sub-graph
    tracktion_RackInstanceNode.{h,cpp}    An instance of a rack on a track
    tracktion_RackReturnNode.{h,cpp}
    tracktion_AuxSendNode.{h,cpp}
    tracktion_InsertSendNode.{h,cpp}
    tracktion_FadeInOutNode.{h,cpp}
    tracktion_ClickNode.{h,cpp}           Metronome
    tracktion_CombiningNode.{h,cpp}       Concatenates clips in a track
    tracktion_ContainerClipNode.{h,cpp}
    tracktion_DynamicOffsetNode.{h,cpp}   Nested-Edit time offset
    tracktion_ArrangerLauncherSwitchingNode.{h,cpp}
    tracktion_SlotControlNode.{h,cpp}     Launcher slot
    tracktion_TrackMutingNode.{h,cpp}, tracktion_TimedMutingNode.{h,cpp}
    tracktion_LevelMeasuringNode.{h,cpp}, tracktion_SharedLevelMeasuringNode.{h,cpp}
    tracktion_LevelMeasurerProcessingNode.h
    tracktion_PlayHeadPositionNode.h
    tracktion_WaveInputDeviceNode.{h,cpp}, tracktion_TrackWaveInputDeviceNode.{h,cpp}
    tracktion_MidiInputDeviceNode.{h,cpp}, tracktion_HostedMidiInputDeviceNode.{h,cpp}
    tracktion_TrackMidiInputDeviceNode.{h,cpp}
    tracktion_LiveMidiInjectingNode.{h,cpp}, tracktion_LiveMidiOutputNode.{h,cpp}
    tracktion_MidiOutputDeviceInstanceInjectingNode.{h,cpp}
    tracktion_ARANode.{h,cpp}             ARA-aware plugin node
    tracktion_BenchmarkUtilities.h

plugins/                                  Plugin hosting + internal plugins
  tracktion_Plugin.{h,cpp}                Plugin base
  tracktion_PluginList.{h,cpp}            A chain of plugins on a track
  tracktion_PluginManager.{h,cpp}         Scanning, blacklist, format registry
  tracktion_PluginScanHelpers.h
  tracktion_PluginWindowState.{h,cpp}
  internal/
    tracktion_VolumeAndPan, tracktion_VCA, tracktion_LevelMeter
    tracktion_AuxSend, tracktion_AuxReturn
    tracktion_InsertPlugin, tracktion_FreezePoint
    tracktion_TextPlugin
    tracktion_RackType, tracktion_RackInstance      (Racks = modular sub-graphs)
    tracktion_ReWirePlugin
  effects/
    tracktion_Chorus, tracktion_Compressor, tracktion_Delay, tracktion_Equaliser
    tracktion_Phaser, tracktion_Reverb, tracktion_LowPass, tracktion_PitchShift
    tracktion_ImpulseResponsePlugin, tracktion_SamplerPlugin
    tracktion_FourOscPlugin
    tracktion_MidiModifier, tracktion_MidiPatchBay, tracktion_PatchBay
    tracktion_ToneGenerator
    tracktion_LatencyPlugin
  external/
    tracktion_ExternalPlugin.{h,cpp}            Wraps VST/AU/CLAP via JUCE
    tracktion_ExternalAutomatableParameter.h
    tracktion_ExternalPluginBlacklist.h
    tracktion_VSTXML.h
  ARA/                                   ARA-enabled plugin support (Melodyne et al.)
  airwindows/                            Airwindows DSP collection, integrated as internal plugins
  cmajor/                                Cmajor / JIT-compiled DSP support

midi/                                     MIDI data model + utilities
  tracktion_MidiList.{h,cpp}              MIDI note/CC/sysex list — the Clip's payload
  tracktion_MidiNote.h                    One note
  tracktion_MidiControllerEvent.h         CC / pitch-bend / program change
  tracktion_MidiSysexEvent.h
  tracktion_MidiExpression.h              MPE channel expression
  tracktion_MidiChannel.h
  tracktion_ActiveNoteList.h              Tracks currently-sounding notes (for stop/all-off)
  tracktion_MidiProgramManager.{h,cpp}
  tracktion_Musicality.{h,cpp}            Keys, scales, chords
  tracktion_SelectedMidiEvents.{h,cpp}

audio_files/                              Audio-file I/O + caching + thumbnails
  tracktion_AudioFile.{h,cpp}             File handle + metadata
  tracktion_AudioFileCache.{h,cpp}        In-memory cache of decoded audio segments
  tracktion_AudioFileManager.h            Coordinates cache + readers + thumbnails + proxies
  tracktion_AudioFileUtils.{h,cpp}
  tracktion_AudioFileWriter.h
  tracktion_AudioFifo.h                   SPSC audio FIFO
  tracktion_AudioFormatManager.{h,cpp}    WAV/AIFF/FLAC/MP3/Ogg format registry
  tracktion_AudioProxyGenerator.h         Background proxy rendering (format conversion, timestretch)
  tracktion_BufferedAudioReader.{h,cpp}   Read-ahead audio reader
  tracktion_BufferedFileReader.{h,cpp}
  tracktion_SmartThumbnail.h              Lazy multi-resolution waveform thumbnails
  tracktion_RecordingThumbnailManager.h
  tracktion_LoopInfo.{h,cpp}              ACID-style loop metadata
  formats/                                Format-specific bits

project/                                  Project DB (projects bundle many Edits)
  tracktion_Project.{h,cpp}
  tracktion_ProjectItem.{h,cpp}           Anything stored in a project (Edit, audio, MIDI file)
  tracktion_ProjectItemID.{h,cpp}         Stable cross-project ID
  tracktion_ProjectManager.{h,cpp}
  tracktion_ProjectSearchIndex.{h,cpp}
  dawproject/                             DAW Project (.dawproject) interchange format

selection/                                Cross-cutting selection model
  tracktion_Selectable.h, tracktion_SelectableClass.h
  tracktion_SelectionManager.{h,cpp}
  tracktion_Clipboard.{h,cpp}

control_surfaces/                         Hardware controller support
  tracktion_ControlSurface.{h,cpp}
  tracktion_CustomControlSurface.{h,cpp}
  tracktion_ExternalController.{h,cpp}
  tracktion_ExternalControllerManager.{h,cpp}
  types/                                  Concrete controllers (Mackie, etc.)

timestretch/                              Timestretch + tempo/beat detection
  tracktion_TimeStretch.{h,cpp}           Unified API over SoundTouch / Rubber Band / ElastiqueLite
  tracktion_ReadAheadTimeStretcher.{h,cpp}
  tracktion_BeatDetect.h
  tracktion_TempoDetect.h

testing/                                  Test helpers (shipped with the engine)
  tracktion_EnginePlayer.h
  tracktion_RoundTripLatency.h

utilities/                                Engine-wide utilities (this is the grab-bag)
  tracktion_Engine.{h,cpp}                Engine singleton — entry point
  tracktion_EngineBehaviour.h             Host-supplied behaviour overrides
  tracktion_Identifiers.h                 Every ValueTree identifier, in one place
  tracktion_PropertyStorage.{h,cpp}       Key/value settings persistence
  tracktion_CrashTracer.{h,cpp}           In-process crash breadcrumbs
  tracktion_CpuMeasurement.h              Audio-thread CPU load meter
  tracktion_Envelope.{h,cpp}, tracktion_Oscillators.{h,cpp}
  tracktion_AudioScratchBuffer.h          Thread-local scratch buffers
  tracktion_AudioFadeCurve.h
  tracktion_Ditherer.h
  tracktion_AtomicWrapper.h, tracktion_SafeScopedListener.h, tracktion_ScopedListener.h
  tracktion_AsyncFunctionUtils.h
  tracktion_BackgroundJobs.h
  tracktion_BinaryData.{h,cpp}
  tracktion_ConstrainedCachedValue.{h,cpp}
  tracktion_ExternalPlayheadSynchroniser.{h,cpp}
  tracktion_FileUtilities.{h,cpp}
  tracktion_MiscUtilities.h
  tracktion_MouseHoverDetector.h
  tracktion_ParameterHelpers.{h,cpp}
  tracktion_Pitch.h
  tracktion_PluginComponent.h
  tracktion_ScreenSaverDefeater.{h,cpp}
  tracktion_CurveEditor.{h,cpp}
  tracktion_AppFunctions.{h,cpp}
```

## Mapping the 12 diagrams to directories

For diagram 2 and all downstream readers:

| Diagram | Primary directories |
|---|---|
| 1. Concepts | (no code — uses names from below as vocabulary) |
| 2. Module graph | `modules/` — JUCE module headers are the source of truth |
| 3. The Edit | `tracktion_engine/model/edit`, plus `model/tracks`, `model/clips` |
| 4. Rendering graph | `tracktion_graph/`, `tracktion_engine/playback/graph/` |
| 5. Transport | `tracktion_engine/playback/` (transport + devices) + `tracktion_graph/tracktion_PlayHead*` |
| 6. Plugins | `tracktion_engine/plugins/` |
| 7. MIDI | `tracktion_engine/midi/`, `tracktion_engine/playback/devices/*Midi*`, graph `*Midi*Node*` |
| 8. Audio files | `tracktion_engine/audio_files/`, `tracktion_engine/timestretch/` |
| 9. Threading | cross-cutting: `tracktion_core/threads/`, `3rd_party/crill,rigtorp,rpmalloc`, all `*.cpp` with audio-thread work |
| 10. Recording & comping | `model/clips/tracktion_CompManager`, `model/tracks/tracktion_TrackCompManager`, `playback/tracktion_EditInputDevices` |
| 11. Automation | `model/automation/`, graph `tracktion_ModifierNode`, `tracktion_AutomatableParameter` |
| 12. Rendering pipeline | `model/export/`, `playback/graph/tracktion_NodeRenderContext`, `plugins/internal/tracktion_FreezePoint` |

## Flags for later diagrams (raised from this inventory alone)

- `PlayHead` lives in `tracktion_graph`, not `tracktion_engine`. The graph
  module is DAW-agnostic *except* for `PlayHead`, which suggests the
  authors wanted transport-relative timing to be a graph-level concept.
  Worth verifying and explaining on diagram 5.
- `tracktion_engine/playback/graph/` contains engine-aware Node subclasses,
  but the abstract `Node` and all schedulers live in `tracktion_graph/`.
  That split is the reason diagram 4 needs two swimlanes (generic vs.
  engine-specific).
- `model/clips/tracktion_CompManager` and `model/tracks/tracktion_TrackCompManager`
  are *both* present — there are two comping managers at different
  granularities. Diagram 10 needs to distinguish them.
- Racks are internal plugins (`plugins/internal/tracktion_RackType`) but
  also appear as graph nodes (`playback/graph/tracktion_RackNode`,
  `tracktion_RackInstanceNode`, `tracktion_RackReturnNode`). The Rack
  abstraction spans both planes — diagram 6 must show that.
- `tracktion_engine/utilities/tracktion_Engine.{h,cpp}` is the singleton
  entry point, but it lives in `utilities/`, not at the module root. Worth
  noting on diagram 3 since `Engine` → `Edit` is the top of the ownership
  tree.
- `3rd_party/` contains `crill`, `rigtorp`, and `rpmalloc` but the
  `tracktion_graph/3rd_party/` tree (not fully listed above) is where
  moodycamel/farbot may live — needs verification before drawing
  diagram 9's lock-free edges.
