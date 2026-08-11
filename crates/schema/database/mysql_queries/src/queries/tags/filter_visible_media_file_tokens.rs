use std::marker::PhantomData;

use sqlx::{Executor, MySql, QueryBuilder, Row};

use enums::common::visibility::Visibility;
use tokens::tokens::media_files::MediaFileToken;
use tokens::tokens::users::UserToken;

pub struct FilterVisibleMediaFileTokensArgs<'e, 'c, E>
where
  E: 'e + Executor<'c, Database = MySql>,
{
  pub candidate_tokens: &'e [MediaFileToken],
  pub requester_user_token: Option<&'e UserToken>,
  pub requester_is_moderator: bool,
  pub mysql_executor: E,
  pub phantom: PhantomData<&'c E>,
}

/// Return only the input tokens whose media file exists, isn't
/// soft-deleted, and whose tags the requester may see: any non-private
/// file (public and hidden files are viewable by anyone with the URL),
/// or the requester's own files. Moderators may view any non-deleted file.
pub async fn filter_visible_media_file_tokens<'e, 'c: 'e, E>(
  args: FilterVisibleMediaFileTokensArgs<'e, 'c, E>,
) -> Result<Vec<MediaFileToken>, sqlx::Error>
where
  E: 'e + Executor<'c, Database = MySql>,
{
  if args.candidate_tokens.is_empty() {
    return Ok(Vec::new());
  }

  let mut builder = build_filter_visible_media_file_tokens_query(
    args.candidate_tokens,
    args.requester_user_token,
    args.requester_is_moderator,
  );

  let rows = builder.build().fetch_all(args.mysql_executor).await?;

  Ok(rows.into_iter()
    .map(|row| MediaFileToken::new(row.get::<String, _>(0)))
    .collect())
}

fn build_filter_visible_media_file_tokens_query(
  candidate_tokens: &[MediaFileToken],
  requester_user_token: Option<&UserToken>,
  requester_is_moderator: bool,
) -> QueryBuilder<'static, MySql> {
  let mut builder = QueryBuilder::<MySql>::new(
    "SELECT token FROM media_files \
     WHERE user_deleted_at IS NULL \
       AND mod_deleted_at IS NULL ",
  );
  if !requester_is_moderator {
    builder.push(" AND (creator_set_visibility != ");
    builder.push_bind(Visibility::Private.to_str());
    if let Some(requester_user_token) = requester_user_token {
      builder.push(" OR maybe_creator_user_token = ");
      builder.push_bind(requester_user_token.as_str().to_string());
    }
    builder.push(")");
  }
  builder.push(" AND token IN (");

  let mut separated = builder.separated(", ");
  for token in candidate_tokens {
    separated.push_bind(token.as_str().to_string());
  }
  separated.push_unseparated(")");

  builder
}

#[cfg(test)]
mod tests {
  use super::*;

  fn candidate_tokens() -> Vec<MediaFileToken> {
    vec![
      MediaFileToken::new("media-a".to_string()),
      MediaFileToken::new("media-b".to_string()),
    ]
  }

  #[test]
  fn anonymous_prompt_context_reads_exclude_deleted_and_private_media() {
    let query = build_filter_visible_media_file_tokens_query(
      &candidate_tokens(),
      None,
      false,
    );
    let sql = query.sql();
    assert!(sql.contains("user_deleted_at IS NULL"));
    assert!(sql.contains("mod_deleted_at IS NULL"));
    assert!(sql.contains("creator_set_visibility !="));
    assert!(!sql.contains("maybe_creator_user_token ="));
  }

  #[test]
  fn owners_can_read_their_private_prompt_context_media() {
    let requester = UserToken::new_from_str("user-a");
    let query = build_filter_visible_media_file_tokens_query(
      &candidate_tokens(),
      Some(&requester),
      false,
    );
    assert!(query.sql().contains("OR maybe_creator_user_token ="));
  }

  #[test]
  fn moderators_can_read_any_non_deleted_prompt_context_media() {
    let query = build_filter_visible_media_file_tokens_query(
      &candidate_tokens(),
      None,
      true,
    );
    let sql = query.sql();
    assert!(sql.contains("user_deleted_at IS NULL"));
    assert!(sql.contains("mod_deleted_at IS NULL"));
    assert!(!sql.contains("creator_set_visibility !="));
  }
}
