( function () {
    'use strict';

    var Q = window.Q;
    var OSG = window.OSG;
    var osg = OSG.osg;
    var osgViewer = OSG.osgViewer;
    var osgDB = OSG.osgDB;
    var osgUtil = OSG.osgUtil;
    var $ = window.$;

    var readImageURL= function ( url, options ) {
        var opts = options || {};
        //opts.imageCrossOrigin = 'anonymous';
        opts.imageLoadingUsePromise = true;
        var ext = url.split( '.' ).pop();
        if ( ext === 'hdr' )
            return osgDB.readImageHDR( url, opts );

        return osgDB.readImageURL.call( this, url, opts );
    };

    var createTextureFromPath = function( path ) {

        var defer = Q.defer();

        readImageURL( path ).then( function ( image ) {

            var texture = new osg.Texture();
            texture.setImage( image );

            texture.setMinFilter( 'NEAREST' );
            texture.setMagFilter( 'NEAREST' );

            defer.resolve( texture );

        });


        return defer.promise;

    };


    var Example = function () {
        this._shaderPath = '';
    };

    Example.prototype = {


        readShaders: function () {

            var defer = Q.defer();

            var shaders = [
                this._shaderPath + 'panoramaVertex.glsl',
                this._shaderPath + 'panoramaFragment.glsl' ];

            var promises = [];

            shaders.forEach( function( shader ) {
                promises.push( Q( $.get( shader ) ) );
            }.bind( this ) );


            Q.all( promises ).then( function ( args ) {

                this._vertexShader = args[ 0 ];
                this._fragmentShader = args[ 1 ];
                defer.resolve();

            }.bind( this ) );

            return defer.promise;
        },

        createShader: function() {

            var vertexshader = [
                this._vertexShader
            ].join('\n');

            var fragmentshader = [
                '#ifdef GL_FRAGMENT_PRECISION_HIGH',
                'precision highp float;',
                '#else',
                'precision mediump float;',
                '#endif',
                this._fragmentShader
            ].join('\n');

            var program = new osg.Program(
                new osg.Shader( 'VERTEX_SHADER', vertexshader ),
                new osg.Shader( 'FRAGMENT_SHADER', fragmentshader ) );

            return program;
        },


        setPanoramaTexture: function( texture, stateSet ) {

            var w = texture.getWidth();
            var name = 'uEnvironment';
            stateSet.addUniform( osg.Uniform.createFloat2( [ w, w/2 ], name + 'Size' ) );
            stateSet.addUniform( osg.Uniform.createInt1( 0, name ) );

        },

        setGlobalUniforms: function( stateSet ) {


            stateSet.addUniform( osg.Uniform.createFloat1( 0.0, 'uLod' ) );


        },

        setupEnvironment: function( scene ) {

            // create the environment sphere
            //var geom = osg.createTexturedSphere(size, 32, 32);
            var size = 500;
            var geom = osg.createTexturedBoxGeometry( 0, 0, 0, size, size, size );
            this._stateSetBackground = geom.getOrCreateStateSet();
            geom.getOrCreateStateSet().setAttributeAndModes( new osg.CullFace( 'DISABLE' ) );

            // display the environment only for pixel on depth == 1 meaning the background
			// unfortunately win dx9 chrome and firefox doesn't get that and doesn't draw any pixel
            //geom.getOrCreateStateSet().setAttributeAndModes( new osg.Depth( 'EQUAL', 1, 1.1, false ) );

            geom.getOrCreateStateSet().setAttributeAndModes( this.getShaderBackground() );
            this._stateSetBackground.setRenderBinDetails( 10, 'RenderBin' );

            var environmentTransform = osg.Uniform.createMatrix4( osg.Matrix.makeIdentity( [] ), 'uEnvironmentTransform' );
            var mt = new osg.MatrixTransform();
            var CullCallback = function () {
                this.cull = function ( node, nv ) {
                    // overwrite matrix, remove translate so environment is always at camera origin
                    osg.Matrix.setTrans( nv.getCurrentModelviewMatrix(), 0, 0, 0 );
                    var m = nv.getCurrentModelviewMatrix();
                    osg.Matrix.copy( m, environmentTransform.get() );
                    environmentTransform.dirty();
                    return true;
                };
            };
            mt.setCullCallback( new CullCallback() );

            var cam = new osg.Camera();
            cam.setClearMask( 0x0 );
            cam.setReferenceFrame( osg.Transform.ABSOLUTE_RF );
            cam.addChild( mt );
            cam.setCullCallback(new CullCallback());


            var self = this;
            // the update callback get exactly the same view of the camera
            // but configure the projection matrix to always be in a short znear/zfar range to not vary depend on the scene size
            var info = {};
            var proj = [];
            var UpdateCallback = function () {
                this.update = function ( /*node, nv*/ ) {
                    var rootCam = self._viewer.getCamera();

                    osg.Matrix.getPerspective( rootCam.getProjectionMatrix(), info );
                    osg.Matrix.makePerspective( info.fovy, info.aspectRatio, 1.0, 1000.0, proj );
                    cam.setProjectionMatrix( proj );
                    cam.setViewMatrix( rootCam.getViewMatrix() );

                    return true;
                };
            };
            cam.setUpdateCallback( new UpdateCallback() );
            scene.addChild( cam );

            return geom;


        },

        createScene: function ( textureEnv ) {

            var root = new osg.Node();
            this.setGlobalUniforms( root.getOrCreateStateSet() );

            var group = new osg.MatrixTransform();
            group.getOrCreateStateSet().setAttributeAndModes( new osg.CullFace('DISABLE'));
            osg.Matrix.makeRotate( Math.PI / 2 , -1,0,0,  group.getMatrix());

            var nodeFunctor = new PanoramanToPanoramaInlineMipmap( textureEnv );
            group.addChild( nodeFunctor );
            nodeFunctor.init();
            nodeFunctor.getPromise().then ( function( texture ) {


                var geom = osg.createTexturedQuadGeometry(-5,-5,0,
                                                          10,0,0,
                                                          0,10,0,
                                                          0,0,
                                                          1,1);


                var mt = new osg.MatrixTransform();
                var sphere = osg.createTexturedSphereGeometry( 5, 20, 20 );
                osg.Matrix.makeTranslate( 20 ,0 ,0, mt.getMatrix() );
                mt.addChild( sphere );

                geom.getOrCreateStateSet().setTextureAttributeAndModes(0, texture );
                sphere.getOrCreateStateSet().setTextureAttributeAndModes(0, texture );
                sphere.getOrCreateStateSet().setAttributeAndModes( this.createShader() );
                this.setPanoramaTexture( texture, sphere.getOrCreateStateSet() );

                //mt.addchild( osg.

                group.addChild( geom );
                group.addChild( mt );

            }.bind( this ));
            return group;

        },

        run: function ( canvas ) {

            var ready = [];

            ready.push( this.readShaders() );
            ready.push( createTextureFromPath('textures/road_in_tenerife_mountain/reference/rgbe/road_in_tenerife_mountain.png') );

            Q.all( ready).then( function( args ) {

                var textureEnv = args[1];

                var viewer;
                viewer = new osgViewer.Viewer( canvas );
                this._viewer = viewer;
                viewer.init();

                var gl = viewer.getState().getGraphicContext();
                console.log( gl.getExtension( 'OES_texture_float' ) );
                console.log( gl.getExtension( 'OES_texture_float_linear' ) );
                console.log( gl.getExtension( 'EXT_shader_texture_lod' ) );

                viewer.setSceneData( this.createScene( textureEnv ) );
                viewer.setupManipulator();
                viewer.getManipulator().computeHomePosition();

                viewer.run();

            }.bind( this ));

        }

    };


    // convert rgbe image to mipmap

    var NodeGenerateMipMapRGBE = function ( texture ) {
        osg.Node.call( this );
        this._texture = texture;

        var nbMip = Math.log( this._texture.getImage().getWidth() ) / Math.log( 2 );
        this._nbMipmap = nbMip - 1;

        var UpdateCallback = function () {
            this._done = false;
            this.update = function ( node, nodeVisitor ) {

                if ( nodeVisitor.getVisitorType() === osg.NodeVisitor.UPDATE_VISITOR ) {
                    if ( this._done )
                        node.setNodeMask( 0 );
                    else
                        this.done = true;
                }
            };
        };
        this.setUpdateCallback( new UpdateCallback() );

    };

    NodeGenerateMipMapRGBE.prototype = osg.objectInherit( osg.Node.prototype, {

        createSubGraph: function ( sourceTexture, destinationTexture, color ) {
            var composer = new osgUtil.Composer();
            var reduce = new osgUtil.Composer.Filter.Custom( [
                '#ifdef GL_ES',
                'precision highp float;',
                '#endif',

                'uniform sampler2D source;',
                'varying vec2 FragTexCoord0;',
                'uniform vec3 color;',

                'vec4 textureRGBE(const in sampler2D texture, const in vec2 uv) {',
                '    vec4 rgbe = texture2D(texture, uv );',

                '    float f = pow(2.0, rgbe.w * 255.0 - (128.0 + 8.0));',
                '    return vec4(rgbe.rgb * 255.0 * f, 1.0);',
                '}',

                'void main() {',
                '  vec3 decode = textureRGBE(source, FragTexCoord0).rgb;',
                '  gl_FragColor = vec4(decode, 1.0);',
                '}',
                ''
            ].join( '\n' ), {
                'source': sourceTexture,
                'color': color
            } );

            composer.addPass( reduce, destinationTexture );
            composer.build();
            return composer;
        },

        createSubGraphFinal: function ( sourceTexture, destinationTexture ) {

            var composer = new osgUtil.Composer();
            var copy = new osgUtil.Composer.Filter.Custom( [
                '#ifdef GL_ES',
                'precision highp float;',
                '#endif',

                'uniform sampler2D source;',
                'uniform float destSize;',
                'uniform float sourceSize;',

                'void main() {',
                '  float offset = sourceSize/2.0;',
                '  if ( gl_FragCoord.x >= sourceSize || ',
                '        gl_FragCoord.y < offset  || gl_FragCoord.y > offset + sourceSize/2.0 ) {',
                '      discard;',
                '      return;',
                '  }',

                '  vec2 uv = vec2( gl_FragCoord.x/sourceSize, (gl_FragCoord.y - offset) / sourceSize/2.0 );',
                '  gl_FragColor = texture2D(source, uv);',
                '}',
                ''
            ].join( '\n' ), {
                'source': sourceTexture,
                'destSize': destinationTexture.getWidth(),
                'sourceSize': sourceTexture.getWidth()
            } );

            composer.addPass( copy, destinationTexture );
            composer.build();
            return composer;
        },

        init: function () {

            var sourceTexture = this._texture;
            var finalTexture = new osg.Texture();
            finalTexture.setMinFilter( 'NEAREST' );
            finalTexture.setMagFilter( 'NEAREST' );

            this._finalTexture = finalTexture;

            var maxSize = Math.pow( 2, this._nbMipmap );
            finalTexture.setTextureSize( maxSize, maxSize );

            var colors = [
                [ 1, 0, 0 ],
                [ 0, 1, 0 ],
                [ 0, 0, 1 ]
            ];

            var root = new osg.Node();

            for ( var i = 0; i < this._nbMipmap; i++ ) {
                var size = Math.pow( 2, this._nbMipmap - i );

                var destinationTexture = new osg.Texture();
                destinationTexture.setMinFilter( 'NEAREST' );
                destinationTexture.setMagFilter( 'NEAREST' );

                destinationTexture.setTextureSize( size, size / 2 );
                var node = this.createSubGraph( sourceTexture, destinationTexture, colors[ i % 3 ] );

                var final = this.createSubGraphFinal( destinationTexture, finalTexture );
                node.addChild( final );
                root.addChild( node );
                sourceTexture = destinationTexture;
            }

            this.addChild( root );
        }


    } );


    // convert rgbe image to float texture
    var TextureRGBEToFloatTexture = function ( texture, dest, textureTarget ) {
        osg.Node.call( this );
        this._texture = texture;
        this._finalTexture = dest;
        this._textureTarget = textureTarget;
        this._defer = Q.defer();

        var self = this;
        var UpdateCallback = function () {
            this._done = false;
            this.update = function ( node, nodeVisitor ) {

                if ( nodeVisitor.getVisitorType() === osg.NodeVisitor.UPDATE_VISITOR ) {
                    if ( this._done ) {
                        self._defer.resolve( self._finalTexture );
                        self._finalTexture.dirtyMipmap();
                        node.setNodeMask( 0 );
                    } else {
                        this._done = true;
                    }
                }
            };
        };
        this.setUpdateCallback( new UpdateCallback() );

    };

    TextureRGBEToFloatTexture.prototype = osg.objectInherit( osg.Node.prototype, {

        getPromise: function() {
            return this._defer.promise;
        },

        createSubGraph: function ( sourceTexture, destinationTexture, textureTarget ) {
            var composer = new osgUtil.Composer();
            var reduce = new osgUtil.Composer.Filter.Custom( [
                '#ifdef GL_ES',
                'precision highp float;',
                '#endif',

                'uniform sampler2D source;',
                'varying vec2 FragTexCoord0;',

                'vec4 textureRGBE(const in sampler2D texture, const in vec2 uv) {',
                '    vec4 rgbe = texture2D(texture, uv );',

                '    float f = pow(2.0, rgbe.w * 255.0 - (128.0 + 8.0));',
                '    return vec4(rgbe.rgb * 255.0 * f, 1.0);',
                '}',

                'void main() {',
                '  vec3 decode = textureRGBE(source, FragTexCoord0).rgb;',
                '  //gl_FragColor = vec4(vec3(1.0,0.0,1.0), 1.0);',
                '  gl_FragColor = vec4(decode, 1.0);',
                '}',
                ''
            ].join( '\n' ), {
                'source': sourceTexture
            } );

            composer.addPass( reduce, destinationTexture, textureTarget );
            composer.build();
            return composer;
        },


        init: function () {

            var sourceTexture = this._texture;
            if ( !this._finalTexture ) {
                var finalTexture = new osg.Texture();
                finalTexture.setTextureSize( sourceTexture.getImage().getWidth(), sourceTexture.getImage().getHeight() );
                finalTexture.setType( 'FLOAT' );
                finalTexture.setMinFilter( 'LINEAR_MIPMAP_LINEAR' );
                finalTexture.setMagFilter( 'LINEAR' );

                this._finalTexture = finalTexture;
            }
            var composer = this.createSubGraph( sourceTexture, this._finalTexture, this._textureTarget );
            this.addChild( composer );
        }


    } );





    // convert rgbe texture list into a cubemap float
    // we could make it more generic by giving parameter
    // like input format ( rgbe / float ) and cubemap output
    var TextureListRGBEToCubemapFloat = function( textureSources ) {
        osg.Geometry.call( this );

        this._defer = Q.defer();
        var finalTexture = new osg.TextureCubeMap();

        this._width = textureSources[0].getImage().getWidth();
        this._height = textureSources[0].getImage().getHeight();

        finalTexture.setTextureSize( this._width, this._height );
        finalTexture.setType( 'FLOAT' );
        finalTexture.setMinFilter( 'LINEAR_MIPMAP_LINEAR' );
        finalTexture.setMagFilter( 'LINEAR' );
        this._textureCubemap = finalTexture;

        this._textureTarget = [
            osg.Texture.TEXTURE_CUBE_MAP_POSITIVE_X,
            osg.Texture.TEXTURE_CUBE_MAP_NEGATIVE_X,
            osg.Texture.TEXTURE_CUBE_MAP_NEGATIVE_Y,
            osg.Texture.TEXTURE_CUBE_MAP_POSITIVE_Y,
            osg.Texture.TEXTURE_CUBE_MAP_POSITIVE_Z,
            osg.Texture.TEXTURE_CUBE_MAP_NEGATIVE_Z
        ];

        this._textureSources = textureSources;
        this._fbo = new osg.FrameBufferObject();
        this._fbo.setAttachment( {
            'attachment': osg.FrameBufferObject.COLOR_ATTACHMENT0,
            'texture': this._textureCubemap,
            'textureTarget': this._textureTarget[0]
        } );

        var self = this;
        var UpdateCallback = function () {
            this._done = false;
            this.update = function ( node, nodeVisitor ) {

                if ( nodeVisitor.getVisitorType() === osg.NodeVisitor.UPDATE_VISITOR ) {
                    if ( this._done ) {
                        self._defer.resolve( self._textureCubemap );
                        self._textureCubemap.dirtyMipmap();
                        node.setNodeMask( 0 );
                    } else {
                        this._done = true;
                    }
                }
            };
        };
        this.setUpdateCallback( new UpdateCallback() );

        var w = this._width;
        var h = this._height;
        var quad = osg.createTexturedQuadGeometry( -w / 2, -h / 2, 0,
                                                   w, 0, 0,
                                                   0, h, 0 );
        this.getAttributes().Vertex = quad.getAttributes().Vertex;
        this.getAttributes().TexCoord0 = quad.getAttributes().TexCoord0;
        this.getPrimitives().push( quad.getPrimitives()[0] );

        this.initStateSet();
    };

    TextureListRGBEToCubemapFloat.prototype = osg.objectInherit( osg.Geometry.prototype, {
        getPromise: function() { return this._defer.promise; },
        initStateSet: function() {
            var ss = this.getOrCreateStateSet();

            var vtx = [
                '#ifdef GL_FRAGMENT_PRECISION_HIGH',
                'precision highp float;',
                '#else',
                'precision mediump float;',
                '#endif',

                'attribute vec3 Vertex;',
                'attribute vec2 TexCoord0;',

                'uniform mat4 ModelViewMatrix;',
                'uniform mat4 ProjectionMatrix;',

                'varying vec2 FragTexCoord0;',

                'void main(void) {',
                '    FragTexCoord0 = TexCoord0;',
                '    gl_Position = ProjectionMatrix * ModelViewMatrix * vec4(Vertex,1.0);',
                '}',
            ].join('\n');

            var frag = [
                '#ifdef GL_ES',
                'precision highp float;',
                '#endif',

                'uniform sampler2D source;',
                'varying vec2 FragTexCoord0;',

                'vec4 textureRGBE(const in sampler2D texture, const in vec2 uv) {',
                '    vec4 rgbe = texture2D(texture, uv );',

                '    float f = pow(2.0, rgbe.w * 255.0 - (128.0 + 8.0));',
                '    return vec4(rgbe.rgb * 255.0 * f, 1.0);',
                '}',

                'void main() {',
                '  vec3 decode = textureRGBE(source, FragTexCoord0).rgb;',
                '  gl_FragColor = vec4(decode, 1.0);',
                '}',
                ''
            ].join('\n');

            ss.addUniform( osg.Uniform.createInt1( 0, 'source' ) );

            var program = new osg.Program(
                new osg.Shader( 'VERTEX_SHADER', vtx ),
                new osg.Shader( 'FRAGMENT_SHADER', frag ) );

            ss.setAttributeAndModes( program );
            ss.setAttributeAndModes( this._fbo );
            ss.setAttributeAndModes( new osg.Depth('DISABLE') );
        },

        draw: function( state ) {
            osg.Geometry.prototype.drawImplementation.call( this, state );
        },

        drawImplementation: function( state ) {

            var gl = state.getGraphicContext();

            // will be applied by stateSet
            //state.applyAttribute( this._fbo );

            var textureID = this._textureCubemap.getTextureObject().id();

            for( var i = 0; i < 6; i++ ) {
                gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this._textureTarget[i] , textureID, 0 );
                var status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
                if ( status !== 0x8CD5 ) {
                    this._fbo._reportFrameBufferError( status );
                }

                state.applyTextureAttribute(0, this._textureSources[i]);

                this.draw( state );
            }
        }

    });

    window.addEventListener( 'load', function () {
        var example = new Example();
        var canvas = $('#View')[0];
        example.run( canvas );
    }, true );

} )();
