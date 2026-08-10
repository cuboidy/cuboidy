#if NETSTANDARD2_1

// The bounded, known cost of carrying netstandard2.1 alongside net8.0
// (docs/csharp-implementation.md, hazard T3). `record`, `init` and `required`
// are compiler features that look for these types by name; the profile does
// not ship them, so the library declares its own. Nothing here is Cuboidy's
// own surface — it is all `internal`, so two assemblies doing the same thing
// never collide.

using System;

namespace System.Runtime.CompilerServices
{
    // `record` and `init` accessors compile to a modreq on this type.
    internal static class IsExternalInit
    {
    }

    [AttributeUsage(
        AttributeTargets.Field | AttributeTargets.Property,
        AllowMultiple = false,
        Inherited = false)]
    internal sealed class RequiredMemberAttribute : Attribute
    {
    }

    [AttributeUsage(AttributeTargets.All, AllowMultiple = true, Inherited = false)]
    internal sealed class CompilerFeatureRequiredAttribute : Attribute
    {
        public CompilerFeatureRequiredAttribute(string featureName)
        {
            FeatureName = featureName;
        }

        public string FeatureName { get; }

        public bool IsOptional { get; init; }

        public const string RefStructs = nameof(RefStructs);
        public const string RequiredMembers = nameof(RequiredMembers);
    }
}

namespace System.Diagnostics.CodeAnalysis
{
    [AttributeUsage(AttributeTargets.Constructor, AllowMultiple = false, Inherited = false)]
    internal sealed class SetsRequiredMembersAttribute : Attribute
    {
    }
}

#endif
