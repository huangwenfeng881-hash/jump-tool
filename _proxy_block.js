  PROXY_URL: (function () {
    try {
      if (typeof location === "undefined") return "";
      if (location.search && location.search.indexOf("proxy=1") >= 0) return "https://jumptool.netlify.app/sb";
      var h = location.hostname || "";
      if (location.protocol !== "https:" || h === "localhost" || h === "127.0.0.1") return "";
      // App 内网页是包内资源域名（没有 /sb 反代），统一走线上代理
      if (h.indexOf("appassets.androidplatform.net") >= 0) return "https://jumptool.netlify.app/sb";
      return location.origin + "/sb";
    } catch (e) { return ""; }
  })(),
