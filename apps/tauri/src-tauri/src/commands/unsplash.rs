const BASE_URL: &str = "https://api.unsplash.com";

fn get_access_key() -> Result<&'static str, String> {
    option_env!("UNSPLASH_ACCESS_KEY")
        .ok_or_else(|| "UNSPLASH_ACCESS_KEY not set at build time".to_string())
}

#[tauri::command]
pub fn unsplash_search_photos(
    query: String,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<serde_json::Value, String> {
    let key = get_access_key()?;
    let page = page.unwrap_or(1);
    let per_page = per_page.unwrap_or(20);

    let url = format!(
        "{}/search/photos?query={}&page={}&per_page={}&orientation=landscape",
        BASE_URL,
        urlencoded(&query),
        page,
        per_page,
    );

    let body = ureq::get(&url)
        .set("Authorization", &format!("Client-ID {}", key))
        .call()
        .map_err(|e| format!("Unsplash search failed: {}", e))?
        .into_string()
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(json)
}

#[tauri::command]
pub fn unsplash_get_topic_photos(
    topic_slug: String,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<serde_json::Value, String> {
    let key = get_access_key()?;
    let page = page.unwrap_or(1);
    let per_page = per_page.unwrap_or(20);

    let url = format!(
        "{}/topics/{}/photos?page={}&per_page={}&orientation=landscape",
        BASE_URL, topic_slug, page, per_page,
    );

    let body = ureq::get(&url)
        .set("Authorization", &format!("Client-ID {}", key))
        .call()
        .map_err(|e| format!("Unsplash topic fetch failed: {}", e))?
        .into_string()
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(json)
}

#[tauri::command]
pub fn unsplash_track_download(download_location_url: String) -> Result<(), String> {
    let key = get_access_key()?;

    let url = format!("{}?client_id={}", download_location_url, key);

    ureq::get(&url)
        .call()
        .map_err(|e| format!("Unsplash download tracking failed: {}", e))?;

    Ok(())
}

fn urlencoded(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                String::from(b as char)
            }
            _ => format!("%{:02X}", b),
        })
        .collect()
}
