using NUnit.Framework;

namespace Cuboidy.Tests;

[TestFixture]
public class RefPathTests
{
    [TestCase("voxels.json")]
    [TestCase("parts/head.json")]
    [TestCase("../shared/palette.json")]
    [TestCase("a.json")]
    public void AcceptsASection8Path(string s)
    {
        Assert.That(RefPath.Validate(s, ".json"), Is.Null);
    }

    [TestCase("voxels.txt", "must be a relative path ending in .json")]
    [TestCase("voxels", "must be a relative path ending in .json")]
    [TestCase(".json", "must be a relative path ending in .json")]
    [TestCase("parts\\head.json", "must use forward slashes")]
    [TestCase("/abs/head.json", "absolute paths are forbidden")]
    [TestCase("C:/models/head.json", "URLs and namespace:key URIs are forbidden")]
    [TestCase("https://example.com/head.json", "URLs and namespace:key URIs are forbidden")]
    [TestCase("res://models/head.json", "URLs and namespace:key URIs are forbidden")]
    [TestCase("parts//head.json", "empty path segment")]
    public void RejectsWithTheRuleSpecificMessage(string s, string message)
    {
        Assert.That(RefPath.Validate(s, ".json"), Is.EqualTo(message));
    }

    [Test]
    public void TheExtensionIsAParameterNotABakedInSuffix()
    {
        Assert.That(RefPath.IsValid("clip.anim", ".anim"), Is.True);
        Assert.That(RefPath.IsValid("clip.anim", ".json"), Is.False);
    }

    [Test]
    public void TheExtensionMustNotBeTheWholePath()
    {
        // `s.length > ext.length` in the reference: a file named exactly
        // ".json" has no stem.
        Assert.That(RefPath.IsValid(".json", ".json"), Is.False);
        Assert.That(RefPath.IsValid("a.json", ".json"), Is.True);
    }

    [Test]
    [NonParallelizable]
    public void SuffixAndPrefixMatchingAreOrdinal()
    {
        // Hazard S4. `EndsWith(string)` and `StartsWith(string)` without a
        // StringComparison use the CURRENT culture, which folds characters —
        // and under tr-TR that includes the one this format's extension
        // contains. `.JSON` is not `.json` under any culture here.
        using (new CultureScope(CultureScope.DotlessI))
        {
            Assert.That(RefPath.IsValid("head.json", ".json"), Is.True);
            Assert.That(RefPath.IsValid("head.JSON", ".json"), Is.False);
            Assert.That(RefPath.IsValid("head.jsoN", ".json"), Is.False);
        }
    }

    [Test]
    [NonParallelizable]
    public void ThePathRulesHoldUnderEveryHostileCulture()
    {
        foreach (string culture in new[]
                 {
                     CultureScope.DecimalComma, CultureScope.DotlessI, CultureScope.NonOrdinalSort,
                 })
        {
            using (new CultureScope(culture))
            {
                Assert.That(RefPath.IsValid("parts/head.json", ".json"), Is.True, culture);
                Assert.That(RefPath.IsValid("/parts/head.json", ".json"), Is.False, culture);
                Assert.That(RefPath.IsValid("parts\\head.json", ".json"), Is.False, culture);
            }
        }
    }
}
