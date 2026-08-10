using System;
using System.Globalization;
using System.Threading;

namespace Cuboidy.Tests;

// Runs a block under a hostile culture. Three of the porting hazards are only
// visible this way and every one of them compiles and passes under en-US:
//
//   de-DE  `double.Parse("1.5")` returns 15, and `(0.5).ToString()` is "0,5"
//          (hazards N2, S5)
//   tr-TR  the dotless i, so `"I".ToLower()` is not "i" (hazard S4)
//   ja-JP  string ordering differs from ordinal — measured, every one of
//          `--mesh-faces`' 608 sorted lines for models/sword moves (hazard S6)
//
// A test that only asserts a value is right does not catch these; it has to
// assert the value is right *here*.
internal sealed class CultureScope : IDisposable
{
    public const string DecimalComma = "de-DE";
    public const string DotlessI = "tr-TR";
    public const string NonOrdinalSort = "ja-JP";

    private readonly CultureInfo _culture;
    private readonly CultureInfo _uiCulture;

    public CultureScope(string name)
    {
        _culture = Thread.CurrentThread.CurrentCulture;
        _uiCulture = Thread.CurrentThread.CurrentUICulture;
        var replacement = CultureInfo.GetCultureInfo(name);
        Thread.CurrentThread.CurrentCulture = replacement;
        Thread.CurrentThread.CurrentUICulture = replacement;
    }

    public void Dispose()
    {
        Thread.CurrentThread.CurrentCulture = _culture;
        Thread.CurrentThread.CurrentUICulture = _uiCulture;
    }
}
