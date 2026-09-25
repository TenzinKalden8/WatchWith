// Content catalog boundary for the UI prototype. Future authorized providers
// can implement this shape without coupling provider selection to room views.
export const testVideoProvider = {
  id: 'test',
  name: 'Test video',
  listContent() {
    return [
      {
        id: 'bbb',
        title: 'Big Buck Bunny',
        detail: 'Blender · 2008 · 9 min',
        provider: 'Test video',
        src: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        art: 'bunny',
      },
      {
        id: 'tears',
        title: 'Tears of Steel',
        detail: 'Blender · 2012 · 12 min',
        provider: 'Test video',
        src: 'https://storage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
        art: 'steel',
      },
    ]
  },
}

export const videoProviders = { test: testVideoProvider }
