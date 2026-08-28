use regex::Regex;
use serde_json::Value;
use std::time::Duration;

fn meta_content(html: &str, property: &str) -> Option<String> {
    let meta_tag = Regex::new(r#"(?is)<meta\b[^>]*>"#).ok()?;
    let attribute = Regex::new(r#"(?is)([\w:-]+)\s*=\s*[\"']([^\"']*)[\"']"#).ok()?;

    let result = meta_tag.find_iter(html).find_map(|tag| {
        let attributes: Vec<_> = attribute
            .captures_iter(tag.as_str())
            .filter_map(|capture| Some((capture.get(1)?.as_str(), capture.get(2)?.as_str())))
            .collect();
        let is_match = attributes.iter().any(|(name, value)| {
            (name.eq_ignore_ascii_case("property") || name.eq_ignore_ascii_case("name"))
                && value.eq_ignore_ascii_case(property)
        });
        is_match.then(|| {
            attributes
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case("content"))
                .map(|(_, value)| value.replace("&amp;", "&"))
        })?
    });
    result
}

fn music_group_image(value: &Value) -> Option<&str> {
    if value.get("@type").and_then(Value::as_str) == Some("MusicGroup") {
        return value.get("image").and_then(Value::as_str);
    }
    match value {
        Value::Array(items) => items.iter().find_map(music_group_image),
        Value::Object(fields) => fields.values().find_map(music_group_image),
        _ => None,
    }
}

fn square_artist_artwork(html: &str) -> Option<String> {
    let script = Regex::new(
        r#"(?is)<script\b[^>]*type\s*=\s*[\"']application/ld\+json[\"'][^>]*>(.*?)</script>"#,
    )
    .ok()?;
    let size = Regex::new(r#"/\d+x\d+bb([.-])"#).ok()?;

    let result = script.captures_iter(html).find_map(|capture| {
        let value: Value = serde_json::from_str(capture.get(1)?.as_str().trim()).ok()?;
        let image = music_group_image(&value)?;
        image
            .starts_with("https://")
            .then(|| size.replace(image, "/600x600bb$1").into_owned())
    });
    result
}

#[tauri::command]
pub async fn get_apple_music_artist_artwork(
    country: String,
    artist_id: u64,
) -> Result<Option<String>, String> {
    let country = country.trim().to_ascii_lowercase();
    if country.len() != 2 || !country.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return Err("Invalid Apple Music country code".into());
    }

    let url = format!("https://music.apple.com/{country}/artist/{artist_id}");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (compatible; Hi-Res-Local/2.0)")
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let html = response.text().await.map_err(|error| error.to_string())?;
    Ok(square_artist_artwork(&html)
        .or_else(|| meta_content(&html, "og:image").filter(|value| value.starts_with("https://"))))
}

#[cfg(test)]
mod tests {
    use super::{meta_content, square_artist_artwork};

    #[test]
    fn extracts_og_image_regardless_of_attribute_order() {
        let html =
            r#"<meta content="https://example.com/artist.jpg?a=1&amp;b=2" property="og:image">"#;
        assert_eq!(
            meta_content(html, "og:image").as_deref(),
            Some("https://example.com/artist.jpg?a=1&b=2")
        );
    }

    #[test]
    fn extracts_square_music_group_image_from_json_ld() {
        let html = r#"<script type="application/ld+json">{"@context":"http://schema.org","@type":"MusicGroup","name":"Ailee","image":"https://is1-ssl.mzstatic.com/image/thumb/Features/a.png/486x486bb.png"}</script>"#;
        assert_eq!(
            square_artist_artwork(html).as_deref(),
            Some("https://is1-ssl.mzstatic.com/image/thumb/Features/a.png/600x600bb.png")
        );
    }
}
