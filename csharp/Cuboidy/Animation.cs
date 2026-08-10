// Port of ts/packages/core/src/animation.ts — the SCHEMA half.
//
// SPEC §6.3–6.9. The manifest's `animations` map (§6.3) is validated here and
// read from `ManifestReader`, which is the same arrangement the reference has.
// The sampler — `samplePart`, `sampleAnimation`, `clampToClip` and the §6.7
// machinery around them — lands in this file too, later; nothing above it
// depends on it.
//
// Poses are emitted in the SPEC's native units (rot = Euler degrees, ZXY
// intrinsic per §4; pos = voxel-unit delta; scale = per-axis multiplier). The
// sampler never touches matrices or quaternions — that conversion is the
// renderer's job.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Cuboidy;

// SPEC §6.5: the per-attribute easing map. Each entry names the interpolation
// curve of the OUTGOING segment (this keyframe → the next, §6.7) for that
// attribute alone; a missing attribute means linear. Deliberately NOT subject
// to carryover (unlike the value fields): easing never propagates to later
// keyframes, so a curve set on one key cannot silently reshape other segments.
// `visible` steps and has no entry.
public sealed record EaseMap(EasingName? Rot, EasingName? Pos, EasingName? Scale);

// SPEC §6.5: a single keyframe. Every value field is optional — an omitted
// field inherits from the previous keyframe (carryover, resolved when the
// track is sampled); `ease` is exempt.
public sealed record Keyframe(
    Vec3? Rot,
    Vec3? Pos,
    Vec3? Scale,
    bool? Visible,
    EaseMap? Ease);

// SPEC §6.6: a part's keyframe sequence, keyed by decimal-string time keys
// ("0.0", "0.5", …). Key format / ordering / start-at-0 / ≤ duration are
// validated on the enclosing animation (they need `duration`); the sampler
// still tolerates unsorted input defensively.
//
// The keys are kept AS WRITTEN and IN DOCUMENT ORDER. §6.6 is a rule about the
// document — "the first key is `0.0`, strictly increasing" — so the spelling
// has to survive reading in order to be checked, and hazard C2 is that
// `Dictionary` enumeration order is explicitly unspecified, on the one rule
// §6.6's decimal point exists to make cross-implementation.
//
// Duplicate keys collapse LAST-WINS, which hazard C3 names time keys as the
// case that matters. `JSON.parse('{"0.0":{},"0.0":{}}')` yields ONE key, so
// the reference accepts that document; a reader that kept both would reject it
// for not strictly increasing. Measured, not assumed.
public sealed record AnimationTrack(OrderedMap<Keyframe> Keys);

// SPEC §6.4 / §6.6.
public sealed record InlineAnimation(
    double Duration,
    bool Loop,
    OrderedMap<AnimationTrack> Parts);

// SPEC §6.3: a value in the animation map is either an inline object or a
// string path to an external animation JSON file — a §8 reference path ending
// in .json, same rule as the palette binding.
//
// Hazard T1's third union-shaped field, and the same answer as §7.4's palette:
// the reader dispatches on `JsonValueKind`, so exactly one of these is set.
public sealed record Animation(InlineAnimation? Inline, string? Ref)
{
    // Narrows the §6.3 union: true for an inline object, false for a ref.
    public bool IsInline => Inline is not null;
}

internal static class AnimationSchema
{
    // SPEC §6.6: a time key is a decimal number string and the point is
    // REQUIRED — "1.0", never "1".
    //
    // That is not cosmetic. A JSON object key spelling a canonical
    // non-negative integer is not an ordinary string key in every language's
    // object model: JavaScript hoists it ahead of the others, so
    // `JSON.parse('{"0.0":…,"0.5":…,"1":…}')` yields keys in the order
    // ["1","0.0","0.5"] and the ordering rules below would reject a document
    // that is written in order. System.Text.Json reads document order and
    // would accept the same file. Requiring the point keeps every legal time
    // key an ordinary string key, so document order and object order agree
    // everywhere and the two implementations agree on what is valid.
    //
    // It also excludes the other spellings a number parser might take —
    // "0x10", "0b11", "1e3", "5.", "+1" — which JavaScript's `Number` accepts
    // and .NET's `double.Parse` does not.
    //
    // `\z`, not `$` — hazard S1.
    public static readonly Regex TimeKeyRegex =
        new Regex(@"^[0-9]+\.[0-9]+\z", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    // SPEC §5 / §6.3: animation names obey the identifier rule.
    public static OrderedMap<Animation> ReadAnimations(JsonElement e, DocPath at) =>
        ReadIdentifierMap(e, at, ReadAnimation);

    public static Animation ReadAnimation(JsonElement e, DocPath at)
    {
        if (e.ValueKind == JsonValueKind.Object)
        {
            return new Animation(ReadInlineAnimation(e, at), null);
        }

        // Anything else is the §8 reference form; a value that is neither an
        // object nor a string reports "expected string".
        return new Animation(null, JsonRead.RefPathValue(e, at, ".json"));
    }

    public static InlineAnimation ReadInlineAnimation(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(e, at, "duration", "loop", "parts");
        double duration = JsonRead.Number(fields.Required("duration"), at.Add("duration"));
        bool loop = JsonRead.Bool(fields.Required("loop"), at.Add("loop"));

        // SPEC §6.4: the keys of `parts` are PART names, and §5 makes a part
        // name an identifier. §6.8 permits a track to target a part the model
        // lacks; it does not permit the key to be something that could not be
        // a part name at all.
        OrderedMap<AnimationTrack> parts =
            ReadIdentifierMap(fields.Required("parts"), at.Add("parts"), ReadTrack);

        var animation = new InlineAnimation(duration, loop, parts);
        CheckAnimation(animation, at);
        return animation;
    }

    public static AnimationTrack ReadTrack(JsonElement e, DocPath at)
    {
        JsonRead.ObjectValue(e, at);
        var keys = new List<KeyValuePair<string, Keyframe>>();
        foreach (JsonProperty property in e.EnumerateObject())
        {
            keys.Add(new KeyValuePair<string, Keyframe>(
                property.Name, ReadKeyframe(property.Value, at.Add(property.Name))));
        }

        return new AnimationTrack(OrderedMap<Keyframe>.From(keys));
    }

    public static Keyframe ReadKeyframe(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(e, at, "rot", "pos", "scale", "visible", "ease");
        return new Keyframe(
            OptionalVec3(fields, at, "rot"),
            OptionalVec3(fields, at, "pos"),
            OptionalVec3(fields, at, "scale"),
            fields.TryGet("visible", out JsonElement visibleEl)
                ? JsonRead.Bool(visibleEl, at.Add("visible"))
                : (bool?)null,
            fields.TryGet("ease", out JsonElement easeEl)
                ? ReadEaseMap(easeEl, at.Add("ease"))
                : null);
    }

    public static EaseMap ReadEaseMap(JsonElement e, DocPath at)
    {
        ObjectFields fields = JsonRead.Fields(e, at, "rot", "pos", "scale");
        return new EaseMap(
            OptionalPreset(fields, at, "rot"),
            OptionalPreset(fields, at, "pos"),
            OptionalPreset(fields, at, "scale"));
    }

    // SPEC §6.4 / §6.6: the semantic rules the document's shape alone cannot
    // express — duration must be a positive finite number covering every time
    // key, and each track's keys must be decimal-number strings starting at 0
    // and strictly increasing.
    //
    // Runs while the animation is being READ, not from the manifest's
    // cross-field pass, which is where the reference runs it too: these are
    // rules about one animation object, and reaching them means that object
    // parsed.
    public static void CheckAnimation(InlineAnimation animation, DocPath at)
    {
        if (double.IsNaN(animation.Duration) || double.IsInfinity(animation.Duration) ||
            animation.Duration <= 0)
        {
            // The per-key ≤ duration checks would only add noise.
            throw JsonRead.Fail(
                CuboidyErrorCode.InvalidValue,
                "duration must be a positive number of seconds",
                at.Add("duration"));
        }

        foreach (KeyValuePair<string, AnimationTrack> entry in animation.Parts)
        {
            DocPath trackAt = at.Add("parts", entry.Key);
            double previous = double.NegativeInfinity;
            bool first = true;

            // Every legal key matches TimeKeyRegex, which no canonical integer
            // does, so this iteration order IS document order.
            foreach (KeyValuePair<string, Keyframe> key in entry.Value.Keys)
            {
                DocPath keyAt = trackAt.Add(key.Key);
                if (!TimeKeyRegex.IsMatch(key.Key))
                {
                    throw JsonRead.Fail(
                        CuboidyErrorCode.InvalidValue,
                        $"time key \"{key.Key}\" is not a decimal number string " +
                        "(the point is required: \"1.0\", not \"1\")",
                        keyAt);
                }

                // InvariantCulture, always — hazard N2. Under de-DE the
                // culture-sensitive overload reads "1.5" as 15, and this is one
                // of the two string→double conversions in the whole closure.
                double t = double.Parse(key.Key, NumberStyles.Float, CultureInfo.InvariantCulture);

                if (first && t != 0)
                {
                    throw JsonRead.Fail(
                        CuboidyErrorCode.InvalidValue,
                        $"first time key must be \"0.0\" (got \"{key.Key}\")",
                        keyAt);
                }

                if (!first && t <= previous)
                {
                    throw JsonRead.Fail(
                        CuboidyErrorCode.InvalidValue,
                        $"time keys must be strictly increasing (\"{key.Key}\" after {Format(previous)})",
                        keyAt);
                }

                if (t > animation.Duration)
                {
                    throw JsonRead.Fail(
                        CuboidyErrorCode.InvalidValue,
                        $"time key \"{key.Key}\" exceeds duration {Format(animation.Duration)}",
                        keyAt);
                }

                first = false;
                previous = t;
            }
        }
    }

    // A map whose KEYS are §5 identifiers and whose order is the document's.
    private static OrderedMap<TValue> ReadIdentifierMap<TValue>(
        JsonElement e,
        DocPath at,
        Func<JsonElement, DocPath, TValue> readValue)
    {
        JsonRead.ObjectValue(e, at);
        var entries = new List<KeyValuePair<string, TValue>>();
        foreach (JsonProperty property in e.EnumerateObject())
        {
            DocPath entryAt = at.Add(property.Name);
            if (!Identifier.IsIdentifier(property.Name))
            {
                throw JsonRead.Fail(
                    CuboidyErrorCode.InvalidValue,
                    "map key must match the identifier regex " +
                    "(letters/digits/_/-, no leading digit or hyphen) and not be a reserved keyword",
                    entryAt);
            }

            entries.Add(new KeyValuePair<string, TValue>(
                property.Name, readValue(property.Value, entryAt)));
        }

        return OrderedMap<TValue>.From(entries);
    }

    private static Vec3? OptionalVec3(ObjectFields fields, DocPath at, string key) =>
        fields.TryGet(key, out JsonElement e) ? JsonRead.Vec3Value(e, at.Add(key)) : (Vec3?)null;

    private static EasingName? OptionalPreset(ObjectFields fields, DocPath at, string key)
    {
        if (!fields.TryGet(key, out JsonElement e)) return null;
        DocPath entryAt = at.Add(key);

        // §11.2 files a STRING outside a closed set under `unknown` — "an
        // unrecognized name appears where the spec defines a closed set of
        // names" — while a value of the wrong JSON type for its field is
        // `invalid-value`. So the VALUE has to be looked at, not just the
        // failure. `fixtures/manifest/unknown/ease-preset.json` pins the first.
        string name = JsonRead.String(e, entryAt);
        if (!Easing.TryParseWire(name, out EasingName preset))
        {
            throw JsonRead.Fail(
                CuboidyErrorCode.Unknown, $"unknown easing preset \"{name}\"", entryAt);
        }

        return preset;
    }

    private static string Format(double value) => value.ToString("R", CultureInfo.InvariantCulture);
}
