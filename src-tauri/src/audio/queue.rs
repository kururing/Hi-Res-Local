use rand::Rng;
use std::collections::{HashSet, VecDeque};

use crate::audio::dto::{AudioTrack, RepeatMode};
use crate::audio::error::{AudioError, AudioResult};

#[derive(Debug, Clone)]
pub struct PlaybackQueue {
    tracks: Vec<AudioTrack>,
    current_index: Option<usize>,
    history_indices: Vec<usize>,
    forward_indices: Vec<usize>,
    repeat_mode: RepeatMode,
    shuffle_enabled: bool,
    recent_history_window: usize,
}

impl Default for PlaybackQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl PlaybackQueue {
    pub fn new() -> Self {
        Self {
            tracks: Vec::new(),
            current_index: None,
            history_indices: Vec::new(),
            forward_indices: Vec::new(),
            repeat_mode: RepeatMode::Off,
            shuffle_enabled: false,
            recent_history_window: 10,
        }
    }

    pub fn tracks(&self) -> &[AudioTrack] {
        &self.tracks
    }

    pub fn current_index(&self) -> Option<usize> {
        self.current_index
    }

    pub fn current_track(&self) -> Option<&AudioTrack> {
        self.current_index.and_then(|idx| self.tracks.get(idx))
    }

    pub fn repeat_mode(&self) -> RepeatMode {
        self.repeat_mode
    }

    pub fn set_repeat_mode(&mut self, mode: RepeatMode) {
        self.repeat_mode = mode;
    }

    pub fn shuffle_enabled(&self) -> bool {
        self.shuffle_enabled
    }

    pub fn set_shuffle_enabled(&mut self, enabled: bool) {
        self.shuffle_enabled = enabled;
    }

    pub fn len(&self) -> usize {
        self.tracks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }

    pub fn add_tracks(&mut self, mut new_tracks: Vec<AudioTrack>) {
        if self.tracks.is_empty() && !new_tracks.is_empty() {
            self.tracks.append(&mut new_tracks);
            self.current_index = Some(0);
        } else {
            self.tracks.append(&mut new_tracks);
        }
    }

    pub fn add_track(&mut self, track: AudioTrack) {
        self.add_tracks(vec![track]);
    }

    pub fn play_next(&mut self, track: AudioTrack) {
        match self.current_index {
            Some(idx) => {
                let insert_pos = (idx + 1).min(self.tracks.len());
                self.tracks.insert(insert_pos, track);
            }
            None => {
                self.tracks.push(track);
                self.current_index = Some(0);
            }
        }
    }

    pub fn play_next_many(&mut self, tracks: Vec<AudioTrack>) {
        match self.current_index {
            Some(idx) => {
                let mut insert_pos = idx + 1;
                for track in tracks {
                    self.tracks.insert(insert_pos, track);
                    insert_pos += 1;
                }
            }
            None => {
                self.add_tracks(tracks);
            }
        }
    }

    pub fn insert_track(&mut self, index: usize, track: AudioTrack) -> AudioResult<()> {
        if index > self.tracks.len() {
            return Err(AudioError::InvalidQueueIndex {
                index,
                len: self.tracks.len(),
            });
        }

        self.tracks.insert(index, track);

        if let Some(curr) = self.current_index {
            if index <= curr {
                self.current_index = Some(curr + 1);
            }
        } else if !self.tracks.is_empty() {
            self.current_index = Some(0);
        }

        Ok(())
    }

    pub fn remove_track(&mut self, index: usize) -> AudioResult<AudioTrack> {
        if index >= self.tracks.len() {
            return Err(AudioError::InvalidQueueIndex {
                index,
                len: self.tracks.len(),
            });
        }

        let removed = self.tracks.remove(index);

        if self.tracks.is_empty() {
            self.current_index = None;
            self.history_indices.clear();
            self.forward_indices.clear();
        } else if let Some(curr) = self.current_index {
            if index < curr {
                self.current_index = Some(curr - 1);
            } else if index == curr {
                if curr >= self.tracks.len() {
                    self.current_index = Some(self.tracks.len() - 1);
                }
            }
        }

        self.history_indices.retain(|&idx| idx != index);
        for idx in &mut self.history_indices {
            if *idx > index {
                *idx -= 1;
            }
        }

        self.forward_indices.retain(|&idx| idx != index);
        for idx in &mut self.forward_indices {
            if *idx > index {
                *idx -= 1;
            }
        }

        Ok(removed)
    }

    pub fn reorder(&mut self, from: usize, to: usize) -> AudioResult<()> {
        let len = self.tracks.len();
        if from >= len {
            return Err(AudioError::InvalidQueueIndex { index: from, len });
        }
        if to >= len {
            return Err(AudioError::InvalidQueueIndex { index: to, len });
        }

        if from == to {
            return Ok(());
        }

        let item = self.tracks.remove(from);
        self.tracks.insert(to, item);

        if let Some(curr) = self.current_index {
            if curr == from {
                self.current_index = Some(to);
            } else if from < curr && to >= curr {
                self.current_index = Some(curr - 1);
            } else if from > curr && to <= curr {
                self.current_index = Some(curr + 1);
            }
        }

        Ok(())
    }

    pub fn clear(&mut self) {
        self.tracks.clear();
        self.current_index = None;
        self.history_indices.clear();
        self.forward_indices.clear();
    }

    pub fn set_current_index(&mut self, index: usize) -> AudioResult<Option<&AudioTrack>> {
        if index >= self.tracks.len() {
            return Err(AudioError::InvalidQueueIndex {
                index,
                len: self.tracks.len(),
            });
        }

        if let Some(prev) = self.current_index {
            if prev != index {
                self.history_indices.push(prev);
                self.forward_indices.clear();
            }
        }

        self.current_index = Some(index);
        Ok(self.current_track())
    }

    pub fn next(&mut self) -> Option<&AudioTrack> {
        if self.tracks.is_empty() {
            return None;
        }

        if self.repeat_mode == RepeatMode::One {
            return self.current_track();
        }

        if let Some(fwd) = self.forward_indices.pop() {
            if fwd < self.tracks.len() {
                if let Some(curr) = self.current_index {
                    self.history_indices.push(curr);
                }
                self.current_index = Some(fwd);
                return self.current_track();
            }
        }

        let current = self.current_index;

        let next_idx = if self.shuffle_enabled {
            self.pick_weighted_shuffle_next()
        } else {
            match current {
                Some(idx) => {
                    if idx + 1 < self.tracks.len() {
                        Some(idx + 1)
                    } else if self.repeat_mode == RepeatMode::All {
                        Some(0)
                    } else {
                        None
                    }
                }
                None => Some(0),
            }
        };

        if let Some(next) = next_idx {
            if let Some(curr) = current {
                self.history_indices.push(curr);
            }
            self.current_index = Some(next);
            self.current_track()
        } else {
            None
        }
    }

    pub fn previous(&mut self) -> Option<&AudioTrack> {
        if self.tracks.is_empty() {
            return None;
        }

        if let Some(prev_idx) = self.history_indices.pop() {
            if prev_idx < self.tracks.len() {
                if let Some(curr) = self.current_index {
                    self.forward_indices.push(curr);
                }
                self.current_index = Some(prev_idx);
                return self.current_track();
            }
        }

        let current = self.current_index;
        let prev_idx = match current {
            Some(idx) => {
                if idx > 0 {
                    Some(idx - 1)
                } else if self.repeat_mode == RepeatMode::All {
                    Some(self.tracks.len() - 1)
                } else {
                    Some(0)
                }
            }
            None => Some(0),
        };

        if let Some(prev) = prev_idx {
            if let Some(curr) = current {
                if curr != prev {
                    self.forward_indices.push(curr);
                }
            }
            self.current_index = Some(prev);
            self.current_track()
        } else {
            None
        }
    }

    pub fn peek_next(&self) -> Option<&AudioTrack> {
        if self.tracks.is_empty() {
            return None;
        }

        if self.repeat_mode == RepeatMode::One {
            return self.current_track();
        }

        if let Some(&fwd) = self.forward_indices.last() {
            if fwd < self.tracks.len() {
                return self.tracks.get(fwd);
            }
        }

        if self.shuffle_enabled {
            self.peek_weighted_shuffle_next()
        } else {
            match self.current_index {
                Some(idx) => {
                    if idx + 1 < self.tracks.len() {
                        self.tracks.get(idx + 1)
                    } else if self.repeat_mode == RepeatMode::All {
                        self.tracks.first()
                    } else {
                        None
                    }
                }
                None => self.tracks.first(),
            }
        }
    }

    fn calculate_recency_weights(&self) -> Vec<f64> {
        let n = self.tracks.len();
        if n == 0 {
            return Vec::new();
        }
        if n == 1 {
            return vec![1.0];
        }

        let mut weights = vec![1.0; n];
        let curr_opt = self.current_index;

        if let Some(curr) = curr_opt {
            if n > 1 {
                weights[curr] = 0.0001;
            }
        }

        let history_window = self.recent_history_window.min(n.saturating_sub(1)).max(1);
        let recent_items: Vec<usize> = self
            .history_indices
            .iter()
            .rev()
            .take(history_window)
            .copied()
            .collect();

        for (order_from_now, &hist_idx) in recent_items.iter().enumerate() {
            if hist_idx < n {
                let recency_penalty = 1.0 / ((order_from_now + 1) as f64 * 2.5);
                let factor = (1.0 - recency_penalty).max(0.05);
                weights[hist_idx] *= factor;
            }
        }

        weights
    }

    pub fn pick_weighted_shuffle_next(&self) -> Option<usize> {
        let n = self.tracks.len();
        if n == 0 {
            return None;
        }
        if n == 1 {
            return Some(0);
        }

        let weights = self.calculate_recency_weights();
        let total_weight: f64 = weights.iter().sum();

        if total_weight <= 0.0 {
            let mut rng = rand::thread_rng();
            return Some(rng.gen_range(0..n));
        }

        let mut rng = rand::thread_rng();
        let mut sample = rng.gen_range(0.0..total_weight);

        for (idx, &w) in weights.iter().enumerate() {
            if sample < w {
                return Some(idx);
            }
            sample -= w;
        }

        Some(n - 1)
    }

    pub fn peek_weighted_shuffle_next(&self) -> Option<&AudioTrack> {
        if self.tracks.is_empty() {
            return None;
        }
        if self.tracks.len() == 1 {
            return self.tracks.first();
        }

        let weights = self.calculate_recency_weights();
        let mut best_idx = 0;
        let mut max_weight = -1.0;

        for (idx, &w) in weights.iter().enumerate() {
            if w > max_weight {
                max_weight = w;
                best_idx = idx;
            }
        }

        self.tracks.get(best_idx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_track(id: &str, title: &str) -> AudioTrack {
        AudioTrack {
            id: id.to_string(),
            path: format!("/path/to/{}.mp3", id),
            title: title.to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            duration_ms: 180_000,
            track_number: None,
            year: None,
            genre: None,
            replay_gain: None,
        }
    }

    #[test]
    fn test_queue_crud_operations() {
        let mut queue = PlaybackQueue::new();
        assert_eq!(queue.len(), 0);
        assert!(queue.is_empty());

        let t1 = create_test_track("1", "Song 1");
        let t2 = create_test_track("2", "Song 2");
        let t3 = create_test_track("3", "Song 3");

        queue.add_tracks(vec![t1.clone(), t2.clone()]);
        assert_eq!(queue.len(), 2);
        assert_eq!(queue.current_index(), Some(0));
        assert_eq!(queue.current_track().unwrap().id, "1");

        queue.add_track(t3.clone());
        assert_eq!(queue.len(), 3);

        let t_insert = create_test_track("4", "Song 4");
        queue.insert_track(1, t_insert).unwrap();
        assert_eq!(queue.len(), 4);
        assert_eq!(queue.tracks()[1].id, "4");
        assert_eq!(queue.current_index(), Some(0));

        let removed = queue.remove_track(1).unwrap();
        assert_eq!(removed.id, "4");
        assert_eq!(queue.len(), 3);

        queue.clear();
        assert_eq!(queue.len(), 0);
        assert_eq!(queue.current_index(), None);
    }

    #[test]
    fn test_play_next_insert_behavior() {
        let mut queue = PlaybackQueue::new();
        let t1 = create_test_track("1", "Song 1");
        let t2 = create_test_track("2", "Song 2");
        let t3 = create_test_track("3", "Song 3");
        queue.add_tracks(vec![t1, t2, t3]);

        queue.set_current_index(0).unwrap();

        let t_next = create_test_track("next", "Play Next Song");
        queue.play_next(t_next);

        assert_eq!(queue.len(), 4);
        assert_eq!(queue.tracks()[1].id, "next");
        assert_eq!(queue.tracks()[2].id, "2");
        assert_eq!(queue.current_index(), Some(0));
    }

    #[test]
    fn test_reorder() {
        let mut queue = PlaybackQueue::new();
        let t1 = create_test_track("1", "Song 1");
        let t2 = create_test_track("2", "Song 2");
        let t3 = create_test_track("3", "Song 3");
        queue.add_tracks(vec![t1, t2, t3]);
        queue.set_current_index(0).unwrap();

        queue.reorder(0, 2).unwrap();
        assert_eq!(queue.tracks()[0].id, "2");
        assert_eq!(queue.tracks()[1].id, "3");
        assert_eq!(queue.tracks()[2].id, "1");
        assert_eq!(queue.current_index(), Some(2));
    }

    #[test]
    fn test_repeat_modes() {
        let mut queue = PlaybackQueue::new();
        let t1 = create_test_track("1", "Song 1");
        let t2 = create_test_track("2", "Song 2");
        queue.add_tracks(vec![t1, t2]);

        // Repeat Off
        queue.set_repeat_mode(RepeatMode::Off);
        assert_eq!(queue.current_track().unwrap().id, "1");
        assert_eq!(queue.next().unwrap().id, "2");
        assert!(queue.next().is_none());

        // Repeat All
        queue.set_repeat_mode(RepeatMode::All);
        queue.set_current_index(1).unwrap();
        assert_eq!(queue.next().unwrap().id, "1");

        // Repeat One
        queue.set_repeat_mode(RepeatMode::One);
        assert_eq!(queue.next().unwrap().id, "1");
        assert_eq!(queue.next().unwrap().id, "1");
    }

    #[test]
    fn test_history_and_previous_navigation() {
        let mut queue = PlaybackQueue::new();
        let t1 = create_test_track("1", "Song 1");
        let t2 = create_test_track("2", "Song 2");
        let t3 = create_test_track("3", "Song 3");
        queue.add_tracks(vec![t1, t2, t3]);

        queue.set_current_index(0).unwrap();
        queue.next(); // At 2 (index 1), history has [0]
        queue.next(); // At 3 (index 2), history has [0, 1]

        let prev = queue.previous().unwrap();
        assert_eq!(prev.id, "2");

        let prev2 = queue.previous().unwrap();
        assert_eq!(prev2.id, "1");

        let fwd = queue.next().unwrap();
        assert_eq!(fwd.id, "2");
    }

    #[test]
    fn test_weighted_shuffle_avoids_recently_played() {
        let mut queue = PlaybackQueue::new();
        for i in 0..10 {
            queue.add_track(create_test_track(&format!("{}", i), &format!("Song {}", i)));
        }

        queue.set_shuffle_enabled(true);
        queue.set_current_index(0).unwrap();

        let mut picked_counts = vec![0; 10];
        let weights = queue.calculate_recency_weights();
        assert!(
            weights[0] < 0.01,
            "Current track must have near-zero weight"
        );

        // Simulate 100 shuffle picks and verify weights calculation doesn't panic
        for _ in 0..100 {
            let next_idx = queue.pick_weighted_shuffle_next().unwrap();
            picked_counts[next_idx] += 1;
        }

        // Current track (index 0) should have very few/zero immediate re-picks
        assert!(
            picked_counts[0] < 5,
            "Immediate repeat in shuffle should be rare"
        );
    }
}
